import assert from "node:assert";
import { trimTrailingArtifacts } from "../src/character/audioContextPlayer";

export function testAudioTailTrimmer() {
  console.log("-> Running tests/audio-tail-trimmer.test.ts");

  const sr = 44100;

  // 1. Clean speech with trailing silence: trims trailing dead air to <= 150ms
  {
    const totalSamples = sr * 3; // 3 seconds total
    const buffer = new Float32Array(totalSamples);
    // 1.5s active speech
    for (let i = 0; i < sr * 1.5; i++) {
      buffer[i] = 0.1 * Math.sin(2 * Math.PI * 440 * (i / sr));
    }
    // 1.5s pure silence (room tone)
    for (let i = Math.floor(sr * 1.5); i < totalSamples; i++) {
      buffer[i] = 0.0005 * (Math.random() - 0.5);
    }

    const trimmed = trimTrailingArtifacts(buffer, sr);
    const trimmedSec = trimmed.length / sr;
    assert(trimmedSec < 1.65, `Expected trimmed length < 1.65s, got ${trimmedSec}s`);
    assert(trimmedSec >= 1.5, `Expected trimmed length >= 1.5s, got ${trimmedSec}s`);
  }

  // 2. Trailing burst after silence gap (Fish Audio scream/groan hallucination)
  {
    const totalSamples = sr * 4;
    const buffer = new Float32Array(totalSamples);
    // 1.0s speech
    for (let i = 0; i < sr * 1.0; i++) {
      buffer[i] = 0.12 * Math.sin(2 * Math.PI * 300 * (i / sr));
    }
    // 400ms silence gap
    for (let i = Math.floor(sr * 1.0); i < Math.floor(sr * 1.4); i++) {
      buffer[i] = 0.001 * (Math.random() - 0.5);
    }
    // 1.2s hallucinated scream/groan
    for (let i = Math.floor(sr * 1.4); i < Math.floor(sr * 2.6); i++) {
      buffer[i] = 0.15 * Math.sin(2 * Math.PI * 800 * (i / sr));
    }
    // 1.4s tail silence
    for (let i = Math.floor(sr * 2.6); i < totalSamples; i++) {
      buffer[i] = 0.0005 * (Math.random() - 0.5);
    }

    const trimmed = trimTrailingArtifacts(buffer, sr, {
      enableBurstExcision: true,
      minGapSec: 0.30,
      tailWindowRatio: 0.75,
      expectedMinDurationSec: 0.8,
    });
    const trimmedSec = trimmed.length / sr;
    assert(trimmedSec <= 1.25, `Expected trimmed length <= 1.25s, got ${trimmedSec}s`);
  }

  // 3. Near-silent buffer safety
  {
    const buffer = new Float32Array(sr);
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = 0.0001 * (Math.random() - 0.5);
    }
    const result = trimTrailingArtifacts(buffer, sr);
    assert.strictEqual(result.length, buffer.length);
  }

  // 4. Normal speech with intra-sentence pauses (300ms, 500ms, 800ms) - Part 2 must NEVER be truncated!
  {
    for (const pauseMs of [300, 500, 800]) {
      const p1Len = Math.floor(sr * 1.0); // "정말..." (1.0s)
      const pauseLen = Math.floor(sr * (pauseMs / 1000)); // Pause
      const p2Len = Math.floor(sr * 1.2); // "그렇게 생각해?" (1.2s)
      const tailLen = Math.floor(sr * 1.0); // 1.0s trailing dead air
      const totalLen = p1Len + pauseLen + p2Len + tailLen;

      const buf = new Float32Array(totalLen);
      for (let i = 0; i < p1Len; i++) buf[i] = 0.1 * Math.sin(2 * Math.PI * 300 * (i / sr));
      for (let i = p1Len; i < p1Len + pauseLen; i++) buf[i] = 0.0005 * (Math.random() - 0.5);
      for (let i = p1Len + pauseLen; i < p1Len + pauseLen + p2Len; i++) buf[i] = 0.1 * Math.sin(2 * Math.PI * 400 * (i / sr));
      for (let i = p1Len + pauseLen + p2Len; i < totalLen; i++) buf[i] = 0.0005 * (Math.random() - 0.5);

      const speechEndSec = (p1Len + pauseLen + p2Len) / sr;
      const trimmed = trimTrailingArtifacts(buf, sr);
      const trimmedSec = trimmed.length / sr;

      assert(
        trimmedSec >= speechEndSec,
        `Pause ${pauseMs}ms FAIL: Part 2 was truncated! (expected >= ${speechEndSec}s, got ${trimmedSec}s)`
      );
      assert(
        trimmedSec <= speechEndSec + 0.15,
        `Pause ${pauseMs}ms FAIL: trailing dead-air not trimmed! (got ${trimmedSec}s, expected <= ${speechEndSec + 0.15}s)`
      );
    }
  }

  console.log("   ✓ AudioTailTrimmer tests passed.");
}
