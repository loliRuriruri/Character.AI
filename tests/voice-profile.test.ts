import { detectLanguage, resolveVoiceProfileConfig } from "../electron/tts";
import { defaultSettings, type CharacterVoiceProfile, type AppSettings } from "../src/shared/types";

export function testVoiceProfile() {
  console.log("-> Running tests/voice-profile.test.ts");

  // 1. Language Detection Tests
  const ko1 = detectLanguage("안녕하세요! 오늘 기분은 어떠신가요?");
  const ko2 = detectLanguage("마스터, 저랑 같이 노래 연습해요!");
  if (ko1 !== "ko" || ko2 !== "ko") {
    throw new Error(`Korean detection failed: ko1=${ko1}, ko2=${ko2}`);
  }

  const ja1 = detectLanguage("初音ミクです。今日もよろしくね！");
  const ja2 = detectLanguage("マスター、こんにちは！歌いましょう。");
  if (ja1 !== "ja" || ja2 !== "ja") {
    throw new Error(`Japanese detection failed: ja1=${ja1}, ja2=${ja2}`);
  }

  const en1 = detectLanguage("Hello master! How can I help you today?");
  const en2 = detectLanguage("Let's create something wonderful together.");
  if (en1 !== "en" || en2 !== "en") {
    throw new Error(`English detection failed: en1=${en1}, en2=${en2}`);
  }

  const zh1 = detectLanguage("你好，世界！很高兴见到你。");
  if (zh1 !== "zh") {
    throw new Error(`Chinese detection failed: zh1=${zh1}`);
  }

  // Mixed scripts: Korean dominant
  const koMixed = detectLanguage("오늘 Ollama AI 세팅 완료했어요!");
  if (koMixed !== "ko") {
    throw new Error(`Mixed Korean detection failed: got ${koMixed}`);
  }

  console.log("   ✓ Language Detection (KO/JA/EN/ZH) passed.");

  // 2. Character Voice Profile Resolution Tests
  const mockProfile: CharacterVoiceProfile = {
    id: "miku_duo",
    displayName: "하츠네 미쿠 (듀얼 엔진)",
    preferredEngine: {
      ko: "voxcpm",
      ja: "fish",
      en: "fish",
      default: "voxcpm",
    },
    fish: {
      referenceId: "fish_default_id",
      koReferenceId: "fish_ko_id",
      jaReferenceId: "6717a74323274cb296ea9a0da654c977",
    },
    voxcpm: {
      koReferenceWav: "miku_korean_clean",
      jaReferenceWav: "miku_japanese_clean",
      cloneMode: "ultimate",
      koPromptText: "안녕하세요 반갑습니다",
      koPromptWav: "miku_korean_prompt.wav",
    },
  };

  const baseVoxSettings: AppSettings = {
    ...defaultSettings,
    ttsProvider: "voxcpm",
  };

  // 2A. Korean Text in VoxCPM -> Keeps VoxCPM + unified referenceWav
  const resKo = resolveVoiceProfileConfig(mockProfile, "오늘 날씨가 정말 화창하고 좋네요!", baseVoxSettings);
  if (resKo.engine !== "voxcpm") {
    throw new Error(`KO routing engine expected 'voxcpm', got '${resKo.engine}'`);
  }
  if (resKo.effectiveSettings.ttsVoiceId !== "miku_korean_clean") {
    throw new Error(`KO voiceId expected 'miku_korean_clean', got '${resKo.effectiveSettings.ttsVoiceId}'`);
  }
  if (resKo.effectiveSettings.voxcpmPromptText !== "안녕하세요 반갑습니다") {
    throw new Error(`KO promptText mismatch: ${resKo.effectiveSettings.voxcpmPromptText}`);
  }
  console.log("   ✓ Korean -> VoxCPM Unified Single Voice passed.");

  // 2B. Japanese Text in VoxCPM -> Also stays on VoxCPM (Unified Single Voice Mode: No tone drift/engine swap!)
  const resJaVox = resolveVoiceProfileConfig(mockProfile, "マスター、今日も一日お疲れ様でした！", baseVoxSettings);
  if (resJaVox.engine !== "voxcpm") {
    throw new Error(`JA routing in VoxCPM mode expected 'voxcpm', got '${resJaVox.engine}'`);
  }
  if (resJaVox.effectiveSettings.ttsVoiceId !== "miku_korean_clean") {
    throw new Error(`JA voiceId in VoxCPM mode expected 'miku_korean_clean', got '${resJaVox.effectiveSettings.ttsVoiceId}'`);
  }
  console.log("   ✓ Japanese in VoxCPM -> Unified Single Voice (zero engine swap latency) passed.");

  // 2C. Japanese Text in Fish Audio mode -> Stays on Fish Audio with unified ID
  const baseFishSettings: AppSettings = {
    ...defaultSettings,
    ttsProvider: "fish",
    fishVoiceId: "6717a74323274cb296ea9a0da654c977",
  };
  const resJaFish = resolveVoiceProfileConfig(mockProfile, "マスター、今日も一日お疲れ様でした！", baseFishSettings);
  if (resJaFish.engine !== "fish") {
    throw new Error(`JA routing in Fish mode expected 'fish', got '${resJaFish.engine}'`);
  }
  if (!resJaFish.effectiveSettings.fishVoiceId) {
    throw new Error(`JA fishVoiceId missing`);
  }
  console.log("   ✓ Japanese in Fish Audio -> Unified Single Voice passed.");

  // 2D. Fallback without profile -> Should return base settings provider
  const resFallback = resolveVoiceProfileConfig(undefined, "안녕하세요", baseVoxSettings);
  if (resFallback.engine !== "voxcpm") {
    throw new Error(`Fallback engine expected 'voxcpm', got '${resFallback.engine}'`);
  }
  console.log("   ✓ Default Fallback without Profile passed.");

  console.log("   ✓ ALL Unified Single Voice Profile tests passed cleanly.");
}
