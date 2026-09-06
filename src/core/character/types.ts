import type { EmotionName, GestureName } from "../../shared/types";

export type CharacterMode = "free" | "rp" | "tutor";

/** 1. 캐릭터 프로필 카드 */
export interface CharacterProfile {
  id: string;
  name: string;
  title: string;
  description: string;
  personality: string[];
  speakingStyle: {
    tone: string;
    endings: string[];
    forbiddenWords: string[];
  };
  scenario: string;
  exampleDialogues?: Array<{ user: string; assistant: string }>;
}

/** 2. 사용자 페르소나 카드 */
export interface PersonaProfile {
  userName: string;
  callName: string; // 캐릭터가 사용자를 부르는 호칭 (예: "마스터", "선배")
  traits: string[];
  relationship: string; // "다정하고 편안한 친구 사이"
  languagePreference: "ko" | "ja" | "en";
}

/** 3. 세계관 및 컨텍스트 프로필 */
export interface ContextProfile {
  worldName: string;
  location: string;
  environmentLore: string;
  timeContext: string;
}

export interface MemoryFact {
  subject: "user" | "character" | "world";
  fact: string;
  sourceTurn?: number;
  timestamp?: number;
}

export interface MemoryItem {
  id?: string;
  text: string;
  status: "active" | "completed" | "resolved";
  createdAt?: number;
}

/** 4. 대화 메모리 (장기 기억 및 롤링 요약) */
export interface ConversationMemory {
  rollingSummary: string;
  facts: string[];
  structuredFacts?: MemoryFact[];
  relationshipState: string;
  promises: string[];
  structuredPromises?: MemoryItem[];
  openThreads: string[];
  structuredThreads?: MemoryItem[];
  summarizedTurnCount: number;
}

/** 5. 3D 씬 상태 (VRM 및 모션 연동) */
export interface SceneState {
  location: string;
  timePeriod: string;
  characterEmotion: EmotionName;
  energyLevel: number; // 0.0 ~ 1.0
  posture: string;
  gazeTarget: "user" | "away" | "down" | "object";
  clothing?: string;
}

/** 6. 프롬프트 구성 블록 */
export interface PromptBlock {
  id: string;
  priority: number;
  content: string;
  estimatedTokens?: number;
}

/** 7. 응답 파서 출력 구조 */
export interface ParsedAssistantResponse {
  raw: string;
  speechText: string;     // TTS로 보낼 순수 대사 (행동 서술 완전 제거)
  displayProse: string;   // 채팅창에 렌더링할 서술문 (마크다운 이탤릭 유지)
  actionCues: string[];   // 파싱된 행동 서술 배열
  inferredGesture?: GestureName;
  inferredEmotion?: EmotionName;
}

/** 8. 확장된 제스처 요청 */
export interface ExtendedGestureRequest {
  gesture: GestureName | null;
  emotion?: EmotionName;
  expression?: string;
  intensity?: number;      // 0.0 ~ 1.0
  durationSec?: number;
  priority?: "low" | "normal" | "high";
  gaze?: "user" | "away" | "down";
}
