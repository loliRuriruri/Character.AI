import assert from "node:assert";
import fs from "node:fs";
import { resolveQwen3WorkerScript, resolveVoiceProfileConfig } from "../electron/tts";
import { applyVoiceSelection, getVoiceReferenceAsset } from "../electron/voices";
import { defaultSettings, type CharacterVoiceProfile } from "../src/shared/types";

export function testQwen3Tts(): void {
  console.log("-> Running tests/qwen3-tts.test.ts");

  // 1. Worker script path resolution
  const workerScript = resolveQwen3WorkerScript();
  assert(fs.existsSync(workerScript), "qwen3_tts_worker.py must exist on disk");
  console.log("   ✓ Qwen3 worker script resolution passed.");

  // 2. Default settings validation
  assert(defaultSettings.qwen3PythonPath.includes("Qwen3-TTS"), "defaultSettings must contain isolated Qwen3-TTS venv path");
  assert(fs.existsSync(defaultSettings.qwen3ReferenceWav), "defaultSettings reference wav must exist");
  console.log("   ✓ Default settings Qwen3 paths verified.");

  // 3. Profile configuration with qwen3tts
  const customProfile: CharacterVoiceProfile = {
    id: "miku_qwen3_profile",
    displayName: "미쿠 Qwen3 프로필",
    preferredEngine: {
      default: "qwen3tts",
      ko: "qwen3tts",
      ja: "qwen3tts",
    },
    qwen3tts: {
      referenceWav: "C:\\TEST\\MikuChat-v3\\assets\\tts\\my_voice_ref.wav",
      promptText: "노이즈가 많은 환경에서도 제 음성 인식은 정확해요.",
    },
  };

  const baseQwenSettings = {
    ...defaultSettings,
    ttsProvider: "qwen3tts" as const,
  };

  const koRes = resolveVoiceProfileConfig(customProfile, "안녕하세요 마스터!", baseQwenSettings);
  assert.strictEqual(koRes.engine, "qwen3tts");
  assert.strictEqual(koRes.detectedLang, "ko");
  assert.strictEqual(koRes.effectiveSettings.ttsProvider, "qwen3tts");
  assert.strictEqual(koRes.effectiveSettings.qwen3PromptText, "노이즈가 많은 환경에서도 제 음성 인식은 정확해요.");
  console.log("   ✓ Korean dialogue resolved to Qwen3-TTS engine cleanly.");

  const jaRes = resolveVoiceProfileConfig(customProfile, "初音ミクです！よろしくね！", baseQwenSettings);
  assert.strictEqual(jaRes.engine, "qwen3tts");
  assert.strictEqual(jaRes.detectedLang, "ja");
  assert.strictEqual(jaRes.effectiveSettings.ttsProvider, "qwen3tts");
  console.log("   ✓ Japanese dialogue resolved to Qwen3-TTS engine cleanly.");

  // 4. Fallback to VoxCPM references when profile qwen3tts fields are omitted
  const fallbackProfile: CharacterVoiceProfile = {
    id: "fallback_profile",
    displayName: "폴백 프로필",
    preferredEngine: {
      default: "qwen3tts",
    },
    voxcpm: {
      defaultReferenceWav: "C:\\TEST\\MikuChat-v3\\assets\\tts\\my_voice_ref.wav",
      koPromptText: "공유된 프롬프트 텍스트",
    },
  };

  const fbRes = resolveVoiceProfileConfig(fallbackProfile, "테스트 문장입니다.", baseQwenSettings);
  assert.strictEqual(fbRes.engine, "qwen3tts");
  assert.strictEqual(fbRes.effectiveSettings.qwen3PromptText, "공유된 프롬프트 텍스트");
  console.log("   ✓ Shared reference fallback from VoxCPM to Qwen3-TTS passed.");

  // 5. Unified Single Voice Mode Toggle Verification
  const overrideProfile: CharacterVoiceProfile = {
    id: "override_profile",
    displayName: "언어별 오버라이드 프로필",
    unifiedSingleVoiceMode: false,
    preferredEngine: {
      default: "voxcpm",
      ko: "voxcpm",
      ja: "qwen3tts",
    },
    voxcpm: {
      koReferenceWav: "C:\\TEST\\MikuChat-v3\\assets\\tts\\my_voice_ref.wav",
      koPromptText: "한국어 VoxCPM 프롬프트",
    },
    qwen3tts: {
      jaReferenceWav: "C:\\TEST\\MikuChat-v3\\assets\\tts\\my_voice_ref.wav",
      jaPromptText: "日本語 Qwen3 プロンプト",
    },
  };

  // When unifiedSingleVoiceMode === false:
  const koOverride = resolveVoiceProfileConfig(overrideProfile, "한국어 테스트입니다.", baseQwenSettings);
  assert.strictEqual(koOverride.engine, "voxcpm", "KO must resolve to voxcpm when unifiedSingleVoiceMode is false");
  assert.strictEqual(koOverride.effectiveSettings.voxcpmPromptText, "한국어 VoxCPM 프롬프트");

  const jaOverride = resolveVoiceProfileConfig(overrideProfile, "日本語のテストです。", baseQwenSettings);
  assert.strictEqual(jaOverride.engine, "qwen3tts", "JA must resolve to qwen3tts when unifiedSingleVoiceMode is false");
  assert.strictEqual(jaOverride.effectiveSettings.qwen3PromptText, "日本語 Qwen3 プロンプト");
  console.log("   ✓ UnifiedSingleVoiceMode=false correctly restores KO/JA engine & reference overrides.");

  // When unifiedSingleVoiceMode === true:
  const unifiedProfile: CharacterVoiceProfile = {
    ...overrideProfile,
    unifiedSingleVoiceMode: true,
  };
  const koUnified = resolveVoiceProfileConfig(unifiedProfile, "한국어 테스트입니다.", baseQwenSettings);
  assert.strictEqual(koUnified.engine, "qwen3tts", "Unified mode must respect baseSettings / unified engine choice");
  console.log("   ✓ UnifiedSingleVoiceMode=true prevents voice fragmentation.");

  // 6. VoiceReferenceAsset structure & sidecar resolution
  const asset = getVoiceReferenceAsset("C:\\TEST\\MikuChat-v3\\assets\\tts\\my_voice_ref.wav");
  assert(asset.audioPath.endsWith("my_voice_ref.wav"), "AudioPath must point to resolved wav");
  assert(asset.transcript && asset.transcript.length > 0, "Transcript must be loaded from sidecar .txt");
  assert.strictEqual(asset.rightsConfirmed, true, "rightsConfirmed must be set");
  console.log("   ✓ Reusable VoiceReferenceAsset correctly parsed with sidecar transcript.");

  // 7. Settings persistence & restart round-trip serialization
  const serialized = JSON.stringify(baseQwenSettings);
  const parsedSettings = JSON.parse(serialized);
  assert.strictEqual(parsedSettings.ttsProvider, "qwen3tts");
  assert.strictEqual(parsedSettings.qwen3Device, "cuda:0");
  assert.strictEqual(parsedSettings.qwen3PythonPath, defaultSettings.qwen3PythonPath);
  console.log("   ✓ Settings persistence & restart round-trip serialization passed.");

  // 8. Catalog voice selection & sidecar transcript alignment
  const appliedReze = applyVoiceSelection("reze");
  assert(appliedReze, "applyVoiceSelection('reze') must return applied voice");
  assert(appliedReze.qwen3ReferenceWav.includes("reze"), "qwen3ReferenceWav must point to reze");
  assert(appliedReze.qwen3PromptText.includes("インターフェース"), "qwen3PromptText must match Reze's transcript");
  console.log("   ✓ Catalog voice Reze selection & transcript pairing passed.");
}
