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

    const trimmed = trimTrailingArtifacts(buffer, sr);
    const trimmedSec = trimmed.length / sr;
    assert(trimmedSec <= 1.2, `Expected trimmed length <= 1.2s, got ${trimmedSec}s`);
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

  console.log("   ✓ AudioTailTrimmer tests passed.");
}
