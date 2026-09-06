import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeRms,
  computeSmoothedRms,
  computeMouthOpen,
  AUDIO_CONFIG,
} from "../src/character/audioContextPlayer";

export function testAudioRms() {
  console.log("-> Running tests/audio-rms.test.ts");

  // 1. Zero/Silence Test
  const silenceSamples = new Float32Array(2048);
  const silenceRms = computeRms(silenceSamples);
  assert.equal(silenceRms, 0, "Silence samples should have RMS = 0");
  const silenceMouth = computeMouthOpen(silenceRms);
  assert.equal(silenceMouth, 0, "Silence mouthOpen should be exactly 0");
  assert.ok(silenceMouth < 0.05, "Silence threshold: mouthOpen must be < 0.05");

  // 2. Low background noise (< RMS_FLOOR = 0.008)
  const lowNoiseSamples = new Float32Array(2048);
  for (let i = 0; i < lowNoiseSamples.length; i++) {
    lowNoiseSamples[i] = (Math.random() - 0.5) * 0.01; // peak ~ 0.005, rms ~ 0.0029
  }
  const lowRms = computeRms(lowNoiseSamples);
  assert.ok(lowRms < AUDIO_CONFIG.RMS_FLOOR, "Low noise RMS should be below floor (0.008)");
  assert.equal(computeMouthOpen(lowRms), 0, "Below floor RMS must yield mouthOpen = 0");

  // 3. Clear Voiced Speech (RMS ~ 0.05 - 0.08)
  const voicedSamples = new Float32Array(2048);
  // Sine wave of amplitude 0.08 (RMS = 0.08 / sqrt(2) ≈ 0.0566)
  for (let i = 0; i < voicedSamples.length; i++) {
    voicedSamples[i] = 0.08 * Math.sin((2 * Math.PI * 440 * i) / 44100);
  }
  const voicedRms = computeRms(voicedSamples);
  assert.ok(voicedRms > 0.05 && voicedRms < 0.06, "Voiced sine RMS should be ~0.056");
  const voicedMouth = computeMouthOpen(voicedRms);
  assert.ok(
    voicedMouth >= 0.30,
    `Voiced threshold: mouthOpen (${voicedMouth.toFixed(3)}) must be >= 0.30`
  );
  assert.ok(voicedMouth <= 1.0, "mouthOpen must be <= 1.0");

  // 4. Loud speech (> RMS_CEILING = 0.12)
  const loudSamples = new Float32Array(2048);
  for (let i = 0; i < loudSamples.length; i++) {
    loudSamples[i] = 0.25 * Math.sin((2 * Math.PI * 440 * i) / 44100); // RMS ~ 0.177
  }
  const loudRms = computeRms(loudSamples);
  assert.ok(loudRms > AUDIO_CONFIG.RMS_CEILING, "Loud RMS must be above ceiling (0.12)");
  const loudMouth = computeMouthOpen(loudRms);
  assert.equal(loudMouth, 1.0, "Above ceiling RMS must clamp to 1.0");

  // 5. Exponential Moving Average (EMA) Smoothing Convergence
  let smoothed = 0;
  const targetRms = 0.06;
  // Over 10 steps, smoothed should smoothly climb towards targetRms
  for (let step = 0; step < 15; step++) {
    smoothed = computeSmoothedRms(smoothed, targetRms, AUDIO_CONFIG.SMOOTH_FACTOR);
  }
  assert.ok(
    Math.abs(smoothed - targetRms) < 0.001,
    `EMA should converge to target RMS (${smoothed.toFixed(4)} vs ${targetRms})`
  );

  console.log("   ✓ AudioRms tests passed.");
}

if (process.argv[1]?.endsWith("audio-rms.test.ts")) {
  testAudioRms();
}
