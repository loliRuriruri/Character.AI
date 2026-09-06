export type LlmProvider = "ollama" | "gemini" | "easyproxy";

export type TtsProvider = "fish" | "voxcpm" | "irodori" | "qwen3tts" | "web";

export type TtsStatus = "idle" | "loading" | "synthesizing" | "speaking";

export type GestureName = "idle" | "wave" | "nod" | "talk" | "cheer" | "sing" | "thinking" | "peace" | "shy" | "bow" | "curious" | "giggle" | "proud" | "explain" | "laugh" | "think" | "shoot" | "spin";

export type ChatMode = "free" | "rp" | "tutor";
export type ViewMode = "full" | "upper" | "pip";

export type TtsVoice = {
  id: string;
  displayName: string;
  wav: string;
  promptText: string;
  sourceWav?: string;
  durationSec?: number;
  rms?: number;
};

export type VoiceCatalog = {
  defaultId: string;
  notes?: string;
  voices: TtsVoice[];
};

export type SrsCard = {
  id: string;
  word: string;
  reading: string;
  meaning: string;
  exampleSentence?: string;
  repetition: number;
  intervalDays: number;
  easeFactor: number;
  nextReviewAt: number;
  createdAt: number;
};

export type VoiceReferenceAsset = {
  id: string;
  displayName: string;
  language: "ko" | "ja" | "en" | "auto";
  audioPath: string;
  transcript?: string;
  durationSec?: number;
  sampleRate?: number;
  source?: "user" | "recording" | "imported" | "other";
  rightsConfirmed?: boolean;
};

export type AppSettings = {
  provider: LlmProvider;
  model: string;
  ollamaUrl: string;
  geminiApiKey: string;
  geminiModel: string;
  easyProxyUrl: string;
  pttKey: string;
  ttsEnabled: boolean;
  ttsProvider: TtsProvider;
  ttsWebFallback: boolean;
  ttsVoiceId: string;
  voxcpmPythonPath: string;
  voxcpmReferenceWav: string;
  voxcpmPromptText: string;
  voxcpmDevice: string;
  qwen3PythonPath: string;
  qwen3ReferenceWav: string;
  qwen3PromptText: string;
  qwen3Device: string;
  characterScale: number;
  vrmModelPath: string;
  vrmaMotionPath: string;
  chatMode: ChatMode;
  irodoriPythonPath: string;
  irodoriLoraId: string;
  viewMode: ViewMode;
  fishApiKey: string;
  fishVoiceId: string;
  fishLatency: "low" | "balanced" | "normal";
  fishFavorites?: FishVoiceFavorite[];
  voiceProfiles?: CharacterVoiceProfile[];
  activeVoiceProfileId?: string;
  userName?: string;
  callName?: string;
  relationship?: string;
};

export type FishVoiceFavorite = {
  id: string;
  title: string;
  languages?: string[];
};

export type CharacterVoiceProfile = {
  id: string;
  displayName: string;
  unifiedSingleVoiceMode?: boolean;
  preferredEngine: {
    ko?: TtsProvider;
    ja?: TtsProvider;
    en?: TtsProvider;
    default?: TtsProvider;
  };
  references?: {
    ko?: string;
    ja?: string;
    en?: string;
    default?: string;
  };
  fish?: {
    referenceId?: string;
    koReferenceId?: string;
    jaReferenceId?: string;
  };
  voxcpm?: {
    koReferenceWav?: string;
    jaReferenceWav?: string;
    defaultReferenceWav?: string;
    koPromptText?: string;
    jaPromptText?: string;
    cloneMode?: "reference" | "ultimate";
  };
  qwen3tts?: {
    referenceWav?: string;
    koReferenceWav?: string;
    jaReferenceWav?: string;
    promptText?: string;
    koPromptText?: string;
    jaPromptText?: string;
    xVectorOnly?: boolean;
  };
  irodori?: {
    modelId?: string;
    loraId?: string;
    language?: "ja";
  };
};

export const defaultSettings: AppSettings = {
  provider: "ollama",
  model: "gemma4:12b",
  ollamaUrl: "http://127.0.0.1:11434",
  geminiApiKey: "",
  geminiModel: "gemini-2.5-flash",
  easyProxyUrl: "http://127.0.0.1:8317/v1/chat/completions",
  pttKey: "Space",
  ttsEnabled: true,
  ttsProvider: "voxcpm",
  ttsWebFallback: true,
  ttsVoiceId: "nilou",
  voxcpmPythonPath: "C:\\Users\\a4jud\\VoxCPM\\.venv\\Scripts\\python.exe",
  voxcpmReferenceWav: "C:\\TEST\\MikuChat-v3\\assets\\tts\\my_voice_ref.wav",
  voxcpmPromptText: "노이즈의 많은 환경에서도, 저의 음성 인식은 정확해요. 마스터의 속삭임도 한 마디도 놓치지 않고 들을 수 있답니다.",
  voxcpmDevice: "auto",
  qwen3PythonPath: "C:\\Users\\a4jud\\Qwen3-TTS\\.venv\\Scripts\\python.exe",
  qwen3ReferenceWav: "C:\\TEST\\MikuChat-v3\\assets\\tts\\my_voice_ref.wav",
  qwen3PromptText: "노이즈가 많은 환경에서도 제 음성 인식은 정확해요. 마스터의 속삭임도 한 마디도 놓치지 않고 들을 수 있답니다.",
  qwen3Device: "cuda:0",
  characterScale: 1.0,
  vrmModelPath: "/models/HatsuneMikuNT.vrm",
  vrmaMotionPath: "/models/idle_loop.vrma",
  chatMode: "free",
  irodoriPythonPath: "C:\\Users\\a4jud\\.vdc-engines\\Irodori-TTS\\.venv\\Scripts\\python.exe",
  irodoriLoraId: "Nilou3000",
  viewMode: "full",
  fishApiKey: "",
  fishVoiceId: "acc8237220d8470985ec9be6c4c480a9",
  fishLatency: "low",
  fishFavorites: [],
  voiceProfiles: [
    {
      id: "default_profile",
      displayName: "기본 미쿠 하이브리드 프로필",
      preferredEngine: {
        ko: "voxcpm",
        ja: "fish",
        default: "voxcpm",
      },
      fish: {
        referenceId: "acc8237220d8470985ec9be6c4c480a9",
        jaReferenceId: "acc8237220d8470985ec9be6c4c480a9",
      },
      voxcpm: {
        defaultReferenceWav: "C:\\TEST\\MikuChat-v3\\assets\\tts\\my_voice_ref.wav",
        koReferenceWav: "C:\\TEST\\MikuChat-v3\\assets\\tts\\my_voice_ref.wav",
        koPromptText: "노이즈가 많은 환경에서도 제 음성 인식은 정확해요. 마스터의 속삭임도 한 마디도 놓치지 않고 들을 수 있답니다.",
        jaReferenceWav: "C:\\TEST\\MikuChat-v3\\assets\\tts\\my_voice_ref.wav",
        jaPromptText: "ノイズの多い環境でも、私の音声認識は正確です。あなたの囁き声も、一言も漏らさず拾えますよ。",
        cloneMode: "ultimate",
      },
      qwen3tts: {
        referenceWav: "C:\\TEST\\MikuChat-v3\\assets\\tts\\my_voice_ref.wav",
        koReferenceWav: "C:\\TEST\\MikuChat-v3\\assets\\tts\\my_voice_ref.wav",
        koPromptText: "노이즈가 많은 환경에서도 제 음성 인식은 정확해요. 마스터의 속삭임도 한 마디도 놓치지 않고 들을 수 있답니다.",
        jaReferenceWav: "C:\\TEST\\MikuChat-v3\\assets\\tts\\my_voice_ref.wav",
        jaPromptText: "ノイズの多い環境でも、私の音声認識は正確です。あなたの囁き声も、一言も漏らさず拾えますよ。",
        xVectorOnly: false,
      },
    },
  ],
  activeVoiceProfileId: "default_profile",
  userName: "마스터",
  callName: "마스터",
  relationship: "서로 신뢰하고 편안하게 마음을 터놓는 가까운 파트너",
};

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  displayProse?: string;
  actionCues?: string[];
  gesture?: GestureName;
  imageBase64?: string;
  tutorFeedback?: {
    correction?: string;
    explanation?: string;
    vocabulary?: { word: string; reading: string; meaning: string }[];
  };
};

export type EmotionName = "neutral" | "happy" | "angry" | "sad" | "surprised" | "relaxed";

export type ProviderHealthStatus = "HEALTHY" | "DEGRADED" | "RECONNECTING" | "OFFLINE";

export type AppState = {
  speaking: boolean;
  pttHeld: boolean;
  chatCollapsed: boolean;
  settings: AppSettings;
  emotion: EmotionName;
  gesture: GestureName;
  lastError: string | null;
  ttsStatus: TtsStatus;
  isThinking: boolean;
  cardsDueCount: number;
  viewMode: ViewMode;
  isMuted: boolean;
  providerHealth?: ProviderHealthStatus;
  providerHealthMessage?: string | null;
};
