import type { EmotionName, GestureName } from "./types";

// Matches [[emotion:happy]], [emotion: happy], [happy], etc. with markdown or whitespace
const EMOTION_TAG_REGEX = /(?:\*\*|\*|[`\[]*)?\[\[?\s*(?:emotion\s*:\s*)?([a-zA-Z가-힣_]+)\s*\]\]?(?:\*\*|\*|[`\]]*)?/gi;

export interface AnalyzedReaction {
  emotion: EmotionName;
  gesture: GestureName;
  cleanText: string;
}

export function parseReaction(raw: string): AnalyzedReaction {
  let emotion: EmotionName = "neutral";
  let gesture: GestureName = "idle";

  // Find the first emotion or gesture tag
  const matches = [...raw.matchAll(EMOTION_TAG_REGEX)];
  if (matches.length > 0) {
    const rawTag = (matches[0][1] || "").toLowerCase().trim();
    if (rawTag === "happy" || rawTag === "joy" || rawTag === "기쁨") {
      emotion = "happy";
      gesture = "cheer";
    } else if (rawTag === "relaxed" || rawTag === "fun" || rawTag === "편안") {
      emotion = "relaxed";
      gesture = "nod";
    } else if (rawTag === "angry" || rawTag === "화남" || rawTag === "삐짐") {
      emotion = "angry";
      gesture = "shy";
    } else if (rawTag === "sad" || rawTag === "sorrow" || rawTag === "슬픔") {
      emotion = "sad";
      gesture = "shy";
    } else if (rawTag === "surprised" || rawTag === "놀람") {
      emotion = "surprised";
      gesture = "wave";
    } else if (rawTag === "sing" || rawTag === "노래") {
      emotion = "happy";
      gesture = "sing";
    } else if (rawTag === "peace" || rawTag === "브이") {
      emotion = "happy";
      gesture = "peace";
    } else if (rawTag === "thinking" || rawTag === "think" || rawTag === "생각") {
      emotion = "relaxed";
      gesture = "thinking";
    } else if (rawTag === "wave" || rawTag === "인사") {
      emotion = "happy";
      gesture = "wave";
    } else if (rawTag === "bow" || rawTag === "절" || rawTag === "목례" || rawTag === "감사") {
      emotion = "happy";
      gesture = "bow";
    } else if (rawTag === "curious" || rawTag === "궁금" || rawTag === "호기심") {
      emotion = "relaxed";
      gesture = "curious";
    } else if (rawTag === "giggle" || rawTag === "웃음" || rawTag === "미소") {
      emotion = "happy";
      gesture = "giggle";
    } else if (rawTag === "proud" || rawTag === "뿌듯" || rawTag === "자랑") {
      emotion = "happy";
      gesture = "proud";
    } else if (rawTag === "shoot" || rawTag === "빵야" || rawTag === "총") {
      emotion = "happy";
      gesture = "shoot";
    } else if (rawTag === "spin" || rawTag === "회전" || rawTag === "턴") {
      emotion = "happy";
      gesture = "spin";
    }
  }

  // Strip all emotion tags completely from text so TTS never speaks them
  let clean = raw.replace(EMOTION_TAG_REGEX, "").trim();
  // Remove markdown symbols that might linger
  clean = clean.replace(/^[\s*#->]+\s*/, "").trim();

  // Natural keyword & conversational context inference if gesture is still idle
  if (gesture === "idle") {
    // 1. Gratitude & Polite Bow
    if (/고마워|감사|잘 부탁|수고했어|실례|다녀올게|다녀왔어/i.test(clean)) {
      gesture = "bow";
      if (emotion === "neutral") emotion = "happy";
    }
    // 2. Questions & Curiosity (물음표, 호기심)
    else if (/\?|궁금|어떤|뭐야|어때|왜|일까|알려줘|어디/i.test(clean)) {
      gesture = "curious";
      if (emotion === "neutral") emotion = "relaxed";
    }
    // 3. Praise & Pride (칭찬, 우쭐)
    else if (/천재|대단해|최고|잘했어|멋져|자랑|뿌듯|완벽/i.test(clean)) {
      gesture = "proud";
      if (emotion === "neutral") emotion = "happy";
    }
    // 4. Giggle & Laughter (웃음, 쑥스러움)
    else if (/[ㅋㅎ]{2,}|헤헤|히히|웃겨|키득|재밌다|장난/i.test(clean)) {
      gesture = "giggle";
      if (emotion === "neutral") emotion = "happy";
    }
    // 5. Greeting (반가운 인사)
    else if (/안녕|반가워|하이|어서와|좋은 아침|좋은 하루/i.test(clean)) {
      gesture = "wave";
      if (emotion === "neutral") emotion = "happy";
    }
    // 6. Singing & Music (노래)
    else if (/노래|멜로디|싱어|음악|라이브|♪|🎵/i.test(clean)) {
      gesture = "sing";
      if (emotion === "neutral") emotion = "happy";
    }
    // 7. Thinking (사색, 고민)
    else if (/생각|고민|글쎄|음~|어쩌지/i.test(clean)) {
      gesture = "thinking";
      if (emotion === "neutral") emotion = "relaxed";
    }
    // 8. Cheer (환호, 흥분)
    else if (/신나|대박|만세|좋아|야호|와아/i.test(clean)) {
      gesture = "cheer";
      if (emotion === "neutral") emotion = "happy";
    }
    // 9. Peace (브이, 귀여움)
    else if (/브이|peace|예쁘다|귀엽/i.test(clean)) {
      gesture = "peace";
      if (emotion === "neutral") emotion = "happy";
    }
    // 10. Agreement (끄덕임)
    else if (/맞아|그렇지|응응|알겠어|네!|그럼그럼/i.test(clean)) {
      gesture = "nod";
    }
    // 11. Shoot (빵야, 손총)
    else if (/빵야|손총|탕탕/i.test(clean)) {
      gesture = "shoot";
      if (emotion === "neutral") emotion = "happy";
    }
    // 12. Spin (한 바퀴, 빙글, 턴)
    else if (/한 바퀴|돌아|빙글/i.test(clean)) {
      gesture = "spin";
      if (emotion === "neutral") emotion = "happy";
    }
  }

  return { emotion, gesture, cleanText: clean };
}

export function parseEmotion(raw: string): EmotionName {
  return parseReaction(raw).emotion;
}

export function stripEmotionTags(raw: string): string {
  return raw.replace(EMOTION_TAG_REGEX, "").trim();
}
