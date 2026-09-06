/**
 * Portions adapted from shinshin86/svg-aituber-chat
 * Copyright (c) 2026 Yuki Shindo
 * MIT License
 * Source: https://github.com/shinshin86/svg-aituber-chat
 * 
 * AudioContext Player & RMS Lip-Sync Driver for MikuChat-v3.
 * Manages lazy singleton AudioContext, decodeAudioData, AudioBufferSourceNode,
 * AnalyserNode RMS energy calculation, and token-guarded source lifecycle.
 */

import { lipSyncBus } from "./lipSyncBus";

export interface AudioTelemetrySample {
  t: number; // ms from start
  rawRms: number;
  smoothedRms: number;
  mouthOpen: number;
  speaking: boolean;
}

export interface AudioPlaybackTimestamps {
  playbackId: number;
  sentenceFinalAt?: number;
  ttsRequestAt?: number;
  ttsAudioReceivedAt?: number;
  decodeStartedAt?: number;
  decodeCompletedAt?: number;
  sourceStartCalledAt?: number;
  sourceEndedAt?: number;
  audioBufferDurationSec: number;
  baseLatencyMs?: number;
  outputLatencyMs?: number;
}

export interface AudioInstrumentationCounters {
  contextsCreated: number;
  contextsClosed: number;
  sourcesCreated: number;
  sourcesActive: number;
  rafActive: number;
}

// Benchmark parameters from reference repository (svg-aituber-chat)
export const AUDIO_CONFIG = {
  SMOOTH_FACTOR: 0.48,
  RMS_FLOOR: 0.008,
  RMS_CEILING: 0.12,
  CURVE_EXP: 0.68,
  FFT_SIZE: 2048,
} as const;

/**
 * Pure math helper: Compute Root Mean Square (RMS) of float time-domain audio samples.
 */
export function computeRms(samples: ArrayLike<number>): number {
  if (!samples || samples.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sumSquares += s * s;
  }
  return Math.sqrt(sumSquares / samples.length);
}

/**
 * Pure math helper: Exponential Moving Average (EMA) smoothing.
 */
export function computeSmoothedRms(
  prev: number,
  cur: number,
  smoothFactor: number = AUDIO_CONFIG.SMOOTH_FACTOR
): number {
  return prev * smoothFactor + cur * (1 - smoothFactor);
}

/**
 * Pure math helper: Normalized non-linear mouth openness curve (0..1).
 */
export function computeMouthOpen(
  smoothedRms: number,
  floor: number = AUDIO_CONFIG.RMS_FLOOR,
  ceiling: number = AUDIO_CONFIG.RMS_CEILING,
  curveExp: number = AUDIO_CONFIG.CURVE_EXP
): number {
  if (smoothedRms <= floor) return 0;
  if (smoothedRms >= ceiling) return 1;
  const normalized = (smoothedRms - floor) / (ceiling - floor);
  return Math.pow(Math.min(Math.max(normalized, 0), 1), curveExp);
}

/**
 * Trims trailing audio hallucinations (screams/sighs/groans) or trailing silence.
 * Detects if an abnormal silence gap (>= 280ms) precedes trailing bursts, or trims excessive silence.
 */
export function trimTrailingArtifacts(
  channelData: Float32Array,
  sampleRate: number
): Float32Array {
  const windowSize = Math.floor(sampleRate * 0.02); // 20ms window
  const hopSize = Math.floor(sampleRate * 0.01); // 10ms hop
  const numFrames = Math.floor((channelData.length - windowSize) / hopSize);
  if (numFrames <= 0) return channelData;

  const rmsValues: number[] = new Array(numFrames);
  let peakRms = 0;
  for (let i = 0; i < numFrames; i++) {
    const offset = i * hopSize;
    let sumSq = 0;
    for (let j = 0; j < windowSize; j++) {
      const s = channelData[offset + j];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / windowSize);
    rmsValues[i] = rms;
    if (rms > peakRms) peakRms = rms;
  }

  if (peakRms < 0.01) return channelData; // Near silence

  const silenceThreshold = 0.005; // -46dB
  const gapFramesRequired = Math.floor(0.28 / 0.01); // 280ms gap

  let lastActiveFrame = numFrames - 1;
  while (lastActiveFrame >= 0 && rmsValues[lastActiveFrame] < silenceThreshold) {
    lastActiveFrame--;
  }

  if (lastActiveFrame < 0) return channelData;

  // Scan backwards from lastActiveFrame to detect hallucinated bursts after a silence gap
  let silentGapCount = 0;
  let cutFrame = lastActiveFrame;

  for (let i = lastActiveFrame; i >= 0; i--) {
    if (rmsValues[i] < silenceThreshold) {
      silentGapCount++;
      if (silentGapCount >= gapFramesRequired) {
        cutFrame = i;
        while (i >= 0 && rmsValues[i] < silenceThreshold) {
          cutFrame = i;
          i--;
        }
        break;
      }
    } else {
      silentGapCount = 0;
    }
  }

  const paddingSamples = Math.floor(sampleRate * 0.08); // 80ms natural decay
  const fadeSamples = Math.floor(sampleRate * 0.02); // 20ms linear fade out
  const cutSample = Math.min(channelData.length, cutFrame * hopSize + paddingSamples + fadeSamples);

  if (cutSample >= channelData.length) return channelData;

  const trimmed = new Float32Array(cutSample);
  trimmed.set(channelData.subarray(0, cutSample));
  const fadeStart = cutSample - fadeSamples;
  for (let i = 0; i < fadeSamples; i++) {
    const idx = fadeStart + i;
    trimmed[idx] *= (1 - (i / fadeSamples));
  }

  return trimmed;
}

export class AudioContextPlayer {
  private context: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private currentGain: GainNode | null = null;
  private currentAnalyser: AnalyserNode | null = null;
  private animationFrameId: number = 0;
  private smoothedRms: number = 0;
  private currentMouthOpen: number = 0;
  private isCurrentlySpeaking: boolean = false;
  private playbackCounter: number = 0;
  private activePlaybackId: number = 0;

  // Telemetry callback & storage
  private telemetrySubscribers: Set<(sample: AudioTelemetrySample) => void> = new Set();
  private lastPlaybackTimestamps: AudioPlaybackTimestamps | null = null;

  // Instrumentation counters
  private counters: AudioInstrumentationCounters = {
    contextsCreated: 0,
    contextsClosed: 0,
    sourcesCreated: 0,
    sourcesActive: 0,
    rafActive: 0,
  };

  /**
   * Get or lazy-create the AudioContext singleton.
   */
  public getContext(): AudioContext {
    if (!this.context || this.context.state === "closed") {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.context = new AudioCtx();
      this.counters.contextsCreated++;
    }
    return this.context;
  }

  public get isSpeaking(): boolean {
    return this.isCurrentlySpeaking;
  }

  public get mouthOpen(): number {
    return this.currentMouthOpen;
  }

  public get rms(): number {
    return this.smoothedRms;
  }

  public getInstrumentation(): AudioInstrumentationCounters {
    return { ...this.counters };
  }

  public getLastTimestamps(): AudioPlaybackTimestamps | null {
    return this.lastPlaybackTimestamps ? { ...this.lastPlaybackTimestamps } : null;
  }

  public subscribeTelemetry(fn: (sample: AudioTelemetrySample) => void): () => void {
    this.telemetrySubscribers.add(fn);
    return () => this.telemetrySubscribers.delete(fn);
  }

  /**
   * Reset the analyzer meter, rAF loop, and mouth openness to zero.
   */
  private resetMeter(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = 0;
      this.counters.rafActive = 0;
    }
    this.smoothedRms = 0;
    this.currentMouthOpen = 0;
    this.isCurrentlySpeaking = false;
    lipSyncBus.emit({ type: "rms:stop" });
  }

  /**
   * Immediately stop playback, disconnect nodes, and clear references.
   */
  public stop(): void {
    this.activePlaybackId = 0; // Invalidate current playback identity token
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        // Source might already have ended or not started.
      }
      try {
        this.currentSource.disconnect();
      } catch {
        // Disconnect safety
      }
      this.currentSource = null;
      if (this.counters.sourcesActive > 0) {
        this.counters.sourcesActive--;
      }
    }
    if (this.currentGain) {
      try { this.currentGain.disconnect(); } catch {}
      this.currentGain = null;
    }
    if (this.currentAnalyser) {
      try { this.currentAnalyser.disconnect(); } catch {}
      this.currentAnalyser = null;
    }
    this.resetMeter();
  }

  /**
   * Decode base64 WAV or ArrayBuffer and play through AudioContext.
   */
  public async play(
    audioData: string | ArrayBuffer,
    timingHints?: { sentenceFinalAt?: number; ttsRequestAt?: number; ttsAudioReceivedAt?: number }
  ): Promise<void> {
    // 1. Stop any currently active playback
    this.stop();
    lipSyncBus.emit({ type: "rms:start" });

    // 2. Prepare ArrayBuffer
    let arrayBuffer: ArrayBuffer;
    if (typeof audioData === "string") {
      const binaryString = atob(audioData);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
      arrayBuffer = bytes.buffer;
    } else {
      arrayBuffer = audioData;
    }

    if (!arrayBuffer || arrayBuffer.byteLength === 0) return;

    // 3. Obtain AudioContext and resume if suspended
    const ctx = this.getContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    // 4. Decode audio data
    const decodeStartedAt = Date.now();
    const rawAudioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const decodeCompletedAt = Date.now();

    // Cleanly trim any trailing autoregressive hallucinations (groans/screams) or dead air
    let audioBuffer = rawAudioBuffer;
    if (rawAudioBuffer.length > ctx.sampleRate * 0.3) {
      const channel0 = rawAudioBuffer.getChannelData(0);
      const trimmed0 = trimTrailingArtifacts(channel0, rawAudioBuffer.sampleRate);
      if (trimmed0.length < rawAudioBuffer.length) {
        const newBuf = ctx.createBuffer(
          rawAudioBuffer.numberOfChannels,
          trimmed0.length,
          rawAudioBuffer.sampleRate
        );
        newBuf.getChannelData(0).set(trimmed0);
        for (let ch = 1; ch < rawAudioBuffer.numberOfChannels; ch++) {
          const chData = rawAudioBuffer.getChannelData(ch);
          const trimmedCh = trimTrailingArtifacts(chData, rawAudioBuffer.sampleRate);
          newBuf.getChannelData(ch).set(trimmedCh.subarray(0, trimmed0.length));
        }
        audioBuffer = newBuf;
      }
    }

    // 5. Build playback identity token
    this.playbackCounter++;
    const playbackId = this.playbackCounter;
    this.activePlaybackId = playbackId;

    // 6. Build Web Audio Graph: Source -> Gain -> Analyser -> Destination
    const source = ctx.createBufferSource();
    this.counters.sourcesCreated++;
    this.counters.sourcesActive++;

    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = AUDIO_CONFIG.FFT_SIZE;

    source.buffer = audioBuffer;
    source.connect(gain);
    gain.connect(analyser);
    analyser.connect(ctx.destination);

    this.currentSource = source;
    this.currentGain = gain;
    this.currentAnalyser = analyser;
    this.isCurrentlySpeaking = true;

    // Record latency parameters
    const sourceStartCalledAt = Date.now();
    const baseLatencyMs = typeof ctx.baseLatency === "number" ? ctx.baseLatency * 1000 : undefined;
    const outputLatencyMs = typeof (ctx as unknown as { outputLatency?: number }).outputLatency === "number"
      ? (ctx as unknown as { outputLatency: number }).outputLatency * 1000
      : undefined;

    this.lastPlaybackTimestamps = {
      playbackId,
      sentenceFinalAt: timingHints?.sentenceFinalAt,
      ttsRequestAt: timingHints?.ttsRequestAt,
      ttsAudioReceivedAt: timingHints?.ttsAudioReceivedAt,
      decodeStartedAt,
      decodeCompletedAt,
      sourceStartCalledAt,
      audioBufferDurationSec: audioBuffer.duration,
      baseLatencyMs,
      outputLatencyMs,
    };

    // 7. Start real-time RMS lip sync animation loop
    const samples = new Float32Array(analyser.fftSize);
    const startTime = performance.now();

    const tick = () => {
      // Guard: Check if playback token is still active and nodes are intact
      if (this.activePlaybackId !== playbackId || !this.currentAnalyser || this.currentSource !== source) {
        return;
      }
      this.currentAnalyser.getFloatTimeDomainData(samples);
      const rawRms = computeRms(samples);
      this.smoothedRms = computeSmoothedRms(this.smoothedRms, rawRms);
      this.currentMouthOpen = computeMouthOpen(this.smoothedRms);

      lipSyncBus.emit({
        type: "rms:frame",
        payload: {
          mouthOpen: this.currentMouthOpen,
          rawRms,
          smoothedRms: this.smoothedRms,
          speaking: this.isCurrentlySpeaking,
        },
      });

      if (this.telemetrySubscribers.size > 0) {
        const sample: AudioTelemetrySample = {
          t: Math.round(performance.now() - startTime),
          rawRms,
          smoothedRms: this.smoothedRms,
          mouthOpen: this.currentMouthOpen,
          speaking: this.isCurrentlySpeaking,
        };
        for (const sub of this.telemetrySubscribers) sub(sample);
      }

      this.animationFrameId = requestAnimationFrame(tick);
      this.counters.rafActive = 1;
    };

    this.animationFrameId = requestAnimationFrame(tick);
    this.counters.rafActive = 1;

    // 8. Wait for source playback completion
    return new Promise<void>((resolve) => {
      source.onended = () => {
        // BB8 Race Condition Guard:
        // Only process onended if this source is STILL the active playback token!
        if (this.activePlaybackId === playbackId) {
          if (this.lastPlaybackTimestamps && this.lastPlaybackTimestamps.playbackId === playbackId) {
            this.lastPlaybackTimestamps.sourceEndedAt = Date.now();
          }
          if (this.currentSource === source) {
            this.currentSource = null;
            if (this.counters.sourcesActive > 0) this.counters.sourcesActive--;
          }
          this.resetMeter();
        }
        resolve();
      };
      source.start();
    });
  }

  /**
   * Teardown AudioContext on application exit.
   */
  public destroy(): void {
    this.stop();
    if (this.context && this.context.state !== "closed") {
      void this.context.close();
      this.counters.contextsClosed++;
    }
    this.context = null;
    this.telemetrySubscribers.clear();
  }
}

export const audioContextPlayer = new AudioContextPlayer();
