import type { EmotionName, GestureName } from "../../shared/types";
import type { ExtendedGestureRequest } from "../character/types";

interface ActionRule {
  pattern: RegExp;
  gesture: GestureName | null;
  emotion: EmotionName;
  expression?: string;
  intensity: number;
  gaze?: "user" | "away" | "down";
}

const ACTION_RULES: ActionRule[] = [
  // 1. Shoot (빵야, 손총)
  {
    pattern: /손총|빵야|탕탕|겨누/i,
    gesture: "shoot",
    emotion: "happy",
    intensity: 1.0,
    gaze: "user",
  },
  // 2. Spin (회전, 턴)
  {
    pattern: /빙글|한\s*바퀴|턴|빙그르르|회전/i,
    gesture: "spin",
    emotion: "happy",
    intensity: 1.0,
    gaze: "user",
  },
  // 3. Bow (정중한 목례, 감사)
  {
    pattern: /공손히|허리.*숙여|꾸벅|목례|정중하|고마워|감사|잘\s*부탁/i,
    gesture: "bow",
    emotion: "happy",
    intensity: 0.9,
    gaze: "down",
  },
  // 4. Wave (손 흔들기, 반가운 인사)
  {
    pattern: /손.*흔들|손인사|반갑게|안녕|손.*번쩍|어서와|좋은\s*아침/i,
    gesture: "wave",
    emotion: "happy",
    intensity: 0.9,
    gaze: "user",
  },
  // 5. Peace (브이, 윙크)
  {
    pattern: /브이|v|윙크|귀엽게\s*포즈/i,
    gesture: "peace",
    emotion: "happy",
    intensity: 0.85,
    gaze: "user",
  },
  // 6. Proud (자랑, 당당함, 허리 손)
  {
    pattern: /허리.*손|당당하게|자랑스럽|우쭐|가슴.*펴|대단해|천재/i,
    gesture: "proud",
    emotion: "happy",
    intensity: 0.8,
    gaze: "user",
  },
  // 7. Giggle (손으로 입 가리고 웃음)
  {
    pattern: /입.*가리고|풋\s*하고|작게\s*웃|키득|미소|헤헤|히히/i,
    gesture: "giggle",
    emotion: "happy",
    intensity: 0.75,
    gaze: "away",
  },
  // 8. Cheer (환호, 만세, 신남)
  {
    pattern: /환호|손.*들고|만세|신나서|방방|야호|와아/i,
    gesture: "cheer",
    emotion: "happy",
    intensity: 1.0,
    gaze: "user",
  },
  // 9. Curious (고개 갸웃, 호기심)
  {
    pattern: /고개.*갸웃|물끄러미|궁금|눈.*동그랗게|호기심|\?/i,
    gesture: "curious",
    emotion: "relaxed",
    intensity: 0.7,
    gaze: "user",
  },
  // 10. Think (턱에 손, 사색, 고민)
  {
    pattern: /생각|턱.*괴고|고민|음~|글쎄|어쩌지/i,
    gesture: "think",
    emotion: "relaxed",
    intensity: 0.7,
    gaze: "away",
  },
  // 11. Shy (부끄러움, 수줍음, 시선 피함) -> Expression: embarrassed, Gaze: away, gesture: null
  {
    pattern: /부끄러|얼굴.*붉|수줍|시선.*피하|머뭇거리|쑥스러/i,
    gesture: null,
    emotion: "relaxed",
    expression: "embarrassed",
    intensity: 0.45,
    gaze: "away",
  },
  // 12. Sing (노래, 콧노래, 리듬)
  {
    pattern: /노래|멜로디|리듬|콧노래|♪|🎵/i,
    gesture: "sing",
    emotion: "happy",
    intensity: 0.8,
    gaze: "user",
  },
  // 13. Nod (고개 끄덕임, 동의)
  {
    pattern: /고개.*끄덕|수긍하듯|응응|맞아|그렇지|알겠어|네!/i,
    gesture: "nod",
    emotion: "happy",
    intensity: 0.75,
    gaze: "user",
  },
];

export class ActionInterpreter {
  /**
   * 파싱된 행동 서술 배열 및 대사 텍스트로부터 최적의 GestureRequest 추론
   */
  static interpret(actionCues: string[], speechFallback?: string): ExtendedGestureRequest {
    // 1. 행동 서술문(Action Cues) 우선 검색
    const actionText = actionCues.join(" ");
    if (actionText.trim()) {
      for (const rule of ACTION_RULES) {
        if (rule.pattern.test(actionText)) {
          return {
            gesture: rule.gesture,
            emotion: rule.emotion,
            expression: rule.expression,
            intensity: rule.intensity,
            gaze: rule.gaze || "user",
            priority: "normal",
          };
        }
      }
    }

    // 2. 행동 서술이 없거나 매칭되지 않은 경우 발화 대사(Speech Fallback)에서 맥락 검색
    if (speechFallback && speechFallback.trim()) {
      for (const rule of ACTION_RULES) {
        if (rule.pattern.test(speechFallback)) {
          return {
            gesture: rule.gesture,
            emotion: rule.emotion,
            expression: rule.expression,
            intensity: rule.intensity,
            gaze: rule.gaze || "user",
            priority: "low",
          };
        }
      }
    }

    // 3. 기본값 (자연스러운 발화 또는 경청)
    return {
      gesture: "talk",
      emotion: "neutral",
      intensity: 0.5,
      gaze: "user",
      priority: "low",
    };
  }
}
