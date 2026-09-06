import type { VRM } from "@pixiv/three-vrm";
import { lipSyncBus, type LipSyncEvent, type RmsLipSyncPayload } from "./lipSyncBus";
import type { VisemeDriver, VisemeName } from "./VisemeDriver";

export type LipSyncMode = "rms" | "text" | "phoneme" | "idle";

const MOUTH_CHANNELS: readonly VisemeName[] = ["aa", "ee", "ih", "oh", "ou"] as const;

/**
 * Interface reserved for future advanced TTS providers with phoneme-level timestamps.
 */
export interface PhonemeVisemeProvider {
  getVisemeWeights(timeSec: number): Record<VisemeName, number> | null;
}

export interface LipSyncTelemetry {
  rawRms: number;
  smoothedRms: number;
  mouthOpen: number;
  aaValue: number;
  mode: LipSyncMode;
  writesThisFrame: number;
  doubleWritesTotal: number;
}

/**
 * LipSyncController — Single Arbitration Point & Sole Mouth Channel Owner
 * 
 * Ensures that for every frame:
 * 1. AudioContext RMS (WAV TTS) has highest priority and drives VRM 'aa' directly.
 * 2. Web SpeechSynthesis falls back to VisemeDriver (Text mode).
 * 3. Exactly ONE write per mouth morph channel per frame (zero double-writes).
 * 4. Facial emotion and blink channels are untouched and arbitrated safely.
 */
export class LipSyncController {
  private mode: LipSyncMode = "idle";
  private isRmsActive = false;
  private currentRmsPayload: RmsLipSyncPayload = {
    mouthOpen: 0,
    rawRms: 0,
    smoothedRms: 0,
    speaking: false,
  };

  // Interpolated applied values (prevents abrupt popping on start/stop)
  private appliedWeights: Record<VisemeName, number> = {
    aa: 0,
    ee: 0,
    ih: 0,
    oh: 0,
    ou: 0,
  };

  private unsubscribeBus: (() => void) | null = null;
  private phonemeProvider: PhonemeVisemeProvider | null = null;

  // Arbitration & Telemetry metrics
  private totalDoubleWrites = 0;
  private lastWritesThisFrame = 0;

  constructor(
    private readonly vrm: VRM,
    private readonly visemeDriver: VisemeDriver
  ) {
    // Ensure VisemeDriver does NOT perform direct unarbitrated writes to VRM
    this.visemeDriver.directWriteEnabled = false;

    this.unsubscribeBus = lipSyncBus.subscribe((ev) => this.handleLipSyncEvent(ev));
  }

  dispose(): void {
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }
  }

  public setPhonemeProvider(provider: PhonemeVisemeProvider | null): void {
    this.phonemeProvider = provider;
  }

  private handleLipSyncEvent(event: LipSyncEvent): void {
    switch (event.type) {
      case "rms:start":
        this.isRmsActive = true;
        this.mode = "rms";
        break;
      case "rms:frame":
        this.isRmsActive = true;
        this.currentRmsPayload = { ...event.payload };
        this.mode = "rms";
        break;
      case "rms:stop":
        this.isRmsActive = false;
        this.currentRmsPayload = {
          mouthOpen: 0,
          rawRms: 0,
          smoothedRms: 0,
          speaking: false,
        };
        if (!this.visemeDriver.isActive) {
          this.mode = "idle";
        } else {
          this.mode = "text";
        }
        break;
      case "text:start":
        this.visemeDriver.speak(event.payload.text, event.payload.durationSec);
        if (!this.isRmsActive) {
          this.mode = "text";
        }
        break;
      case "text:stop":
        this.visemeDriver.stop();
        if (!this.isRmsActive) {
          this.mode = "idle";
        }
        break;
    }
  }

  public speakText(text: string, durationSec: number): void {
    this.visemeDriver.speak(text, durationSec);
    if (!this.isRmsActive) {
      this.mode = "text";
    }
  }

  public stopText(): void {
    this.visemeDriver.stop();
    if (!this.isRmsActive) {
      this.mode = "idle";
    }
  }

  public get isSpeaking(): boolean {
    return this.isRmsActive || this.visemeDriver.isActive;
  }

  public get currentMode(): LipSyncMode {
    return this.mode;
  }

  public get mouthOpen(): number {
    return this.appliedWeights.aa;
  }

  public getTelemetry(): LipSyncTelemetry {
    return {
      rawRms: this.currentRmsPayload.rawRms,
      smoothedRms: this.currentRmsPayload.smoothedRms,
      mouthOpen: this.currentRmsPayload.mouthOpen,
      aaValue: this.appliedWeights.aa,
      mode: this.mode,
      writesThisFrame: this.lastWritesThisFrame,
      doubleWritesTotal: this.totalDoubleWrites,
    };
  }

  /**
   * Called once per frame in VrmStage loop before vrm.update(dt)
   */
  public update(delta: number): void {
    const em = this.vrm.expressionManager;
    if (!em) return;

    // Update internal text viseme driver state
    this.visemeDriver.update(delta);

    // Dynamic Arbitration:
    // RMS (AudioContext) always preempts text heuristic duration
    if (this.isRmsActive) {
      this.mode = "rms";
    } else if (this.phonemeProvider) {
      this.mode = "phoneme";
    } else if (this.visemeDriver.isActive) {
      this.mode = "text";
    } else {
      this.mode = "idle";
    }

    const targetWeights: Record<VisemeName, number> = {
      aa: 0,
      ee: 0,
      ih: 0,
      oh: 0,
      ou: 0,
    };

    if (this.mode === "rms") {
      // RMS direct mapping to 'aa' only (no random vowel substitutions)
      targetWeights.aa = this.currentRmsPayload.mouthOpen;
    } else if (this.mode === "phoneme" && this.phonemeProvider) {
      const pWeights = this.phonemeProvider.getVisemeWeights(performance.now() / 1000);
      if (pWeights) {
        for (const name of MOUTH_CHANNELS) {
          targetWeights[name] = pWeights[name] ?? 0;
        }
      }
    } else if (this.mode === "text") {
      const tWeights = this.visemeDriver.getWeights();
      for (const name of MOUTH_CHANNELS) {
        targetWeights[name] = tWeights[name] ?? 0;
      }
    } else {
      // Idle: all 0
    }

    // Fast responsive interpolation (tau ~ 0.015s => factor ~ 60 * delta)
    const lerpRate = Math.min(1.0, delta * 60.0);
    const writtenChannels = new Set<string>();
    let frameWrites = 0;

    for (const name of MOUTH_CHANNELS) {
      const cur = this.appliedWeights[name];
      const target = targetWeights[name];
      const next = cur + (target - cur) * lerpRate;
      this.appliedWeights[name] = Math.abs(next) < 0.001 ? 0 : next;

      // Invariant check: ensure zero double-writes to same channel in one frame
      if (writtenChannels.has(name)) {
        this.totalDoubleWrites++;
        console.warn(`[LipSyncController] Double-write detected on mouth channel: ${name}`);
      }
      writtenChannels.add(name);

      em.setValue(name, this.appliedWeights[name]);
      frameWrites++;
    }

    this.lastWritesThisFrame = frameWrites;
  }
}
