import type { EmotionName } from "../../shared/types";
import type { SceneState } from "../character/types";

export interface ScenePatch {
  location?: string;
  posture?: string;
  emotion?: EmotionName;
  gazeTarget?: "user" | "away" | "down" | "object";
  activity?: string;
  energyLevel?: number;
}

export class SceneStateManager {
  private state: SceneState;

  constructor(initial?: Partial<SceneState>) {
    this.state = {
      location: initial?.location || "미쿠의 디지털 작업실 / 데스크톱 룸",
      timePeriod: initial?.timePeriod || this.detectCurrentTimePeriod(),
      characterEmotion: initial?.characterEmotion || "neutral",
      energyLevel: initial?.energyLevel ?? 0.8,
      posture: initial?.posture || "자연스럽게 서서 사용자를 마주 봄",
      gazeTarget: initial?.gazeTarget || "user",
      clothing: initial?.clothing || "기본 하츠네 미쿠 스테이지 의상",
    };
  }

  getState(): SceneState {
    return { ...this.state };
  }

  /**
   * Apply an incremental patch: previous SceneState + ScenePatch = next SceneState
   */
  applyPatch(patch: ScenePatch): SceneState {
    if (patch.location && patch.location.trim()) {
      this.state.location = patch.location.trim();
    }
    if (patch.posture && patch.posture.trim()) {
      this.state.posture = patch.posture.trim();
    }
    if (patch.emotion) {
      this.state.characterEmotion = patch.emotion;
    }
    if (patch.gazeTarget) {
      this.state.gazeTarget = patch.gazeTarget;
    }
    if (typeof patch.energyLevel === "number") {
      this.state.energyLevel = Math.max(0.1, Math.min(1.0, patch.energyLevel));
    }
    return this.getState();
  }

  update(partial: Partial<SceneState>): void {
    this.state = { ...this.state, ...partial };
  }

  setEmotion(emotion: EmotionName): void {
    this.state.characterEmotion = emotion;
  }

  setLocation(location: string): void {
    this.state.location = location;
  }

  setPosture(posture: string): void {
    this.state.posture = posture;
  }

  setGazeTarget(gaze: "user" | "away" | "down" | "object"): void {
    this.state.gazeTarget = gaze;
  }

  refreshTimePeriod(): void {
    this.state.timePeriod = this.detectCurrentTimePeriod();
  }

  private detectCurrentTimePeriod(): string {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) return "상쾌한 아침";
    if (hour >= 11 && hour < 17) return "따스한 오후";
    if (hour >= 17 && hour < 22) return "포근한 저녁";
    return "조용한 심야";
  }

  /**
   * Extract dynamic ScenePatch from dialogue text and RP action cues
   */
  extractPatch(text: string, actionCues: string[] = []): ScenePatch {
    const patch: ScenePatch = {};
    const combined = `${text} ${actionCues.join(" ")}`.trim();

    // 1. Location extraction
    // "우리 바닷가 카페로 가자", "공원으로 산책 가자", "도서관에 도착했어"
    const locMatch = combined.match(/(?:우리\s+)?([가-힣a-zA-Z0-9\s]{2,15})(?:으?로\s*(?:가자|이동하자|갈까)|에\s*(?:도착했어|왔어|있어|가자))/);
    if (locMatch) {
      const candidateLoc = locMatch[1].trim();
      if (!/(?:앞|뒤|옆|함께|같이|이제|빨리)/.test(candidateLoc)) {
        patch.location = candidateLoc;
      }
    }

    // 2. Posture extraction from actions/dialogue
    if (/(?:앉는다|앉으며|앉자|앉아|털썩|자리에\s*앉|소파에|바닥에\s*편하게)/i.test(combined)) {
      patch.posture = "sitting";
    } else if (/(?:일어선다|일어나|일어났다|서서|일어설까)/i.test(combined)) {
      patch.posture = "standing";
    } else if (/(?:눕는다|누워|누웠다|침대에)/i.test(combined)) {
      patch.posture = "lying";
    } else if (/(?:기대어|기댄다|벽에\s*기)/i.test(combined)) {
      patch.posture = "leaning";
    }

    // 3. Emotion extraction
    if (/(?:수줍|부끄|얼굴.*붉|쑥스러)/i.test(combined)) {
      patch.emotion = "relaxed"; // embarrassed expression mapped to relaxed state
    } else if (/(?:화가|짜증|화남|분노)/i.test(combined)) {
      patch.emotion = "angry";
    } else if (/(?:슬프|울먹|눈물|울컥|속상)/i.test(combined)) {
      patch.emotion = "sad";
    } else if (/(?:기뻐|행복|신나|환한|활짝|와아|야호)/i.test(combined)) {
      patch.emotion = "happy";
    } else if (/(?:놀라|깜짝|헉)/i.test(combined)) {
      patch.emotion = "surprised";
    }

    // 4. GazeTarget extraction
    if (/(?:시선.*(?:피하|피한|피해|돌리|돌려|떨구|내리)|고개.*돌려|창밖.*응시|먼\s*곳.*바라|먼산)/i.test(combined)) {
      patch.gazeTarget = "away";
    } else if (/(?:고개.*(?:숙이|숙인|숙여|푹)|바닥.*바라|발끝.*응시)/i.test(combined)) {
      patch.gazeTarget = "down";
    } else if (/(?:마주.*(?:보|본|맞추)|눈을.*맞추|바라보|응시하|쳐다보)/i.test(combined)) {
      patch.gazeTarget = "user";
    }

    // 5. Activity extraction
    if (/(?:공부|숙제|과제)/i.test(combined)) {
      patch.activity = "studying";
    } else if (/(?:노래|노래\s*연습|멜로디)/i.test(combined)) {
      patch.activity = "singing";
    } else if (/(?:산책|걷기|산책하)/i.test(combined)) {
      patch.activity = "walking";
    } else if (/(?:커피|차를\s*마시|음료|카페)/i.test(combined)) {
      patch.activity = "drinking tea";
    }

    return patch;
  }

  /**
   * Process a turn: extract patch from dialogue and action cues, then apply incrementally
   */
  processTurn(userInput: string, assistantSpeech: string = "", actionCues: string[] = []): ScenePatch {
    const patch = this.extractPatch(`${userInput} ${assistantSpeech}`, actionCues);
    this.applyPatch(patch);
    return patch;
  }
}
