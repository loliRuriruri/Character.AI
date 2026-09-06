import { isLikelyActionProse } from "./ResponseParser";

// Characters and words uniquely characteristic of Chinese dialogue and grammar
export const CHINESE_INDICATOR_REGEX = /[你您他她它们这那哪谁什么吗呢吧的得地了着过啊呀没很太真想要喜欢吃喝看听说做让给去来能会欢门关开问经现样题变动点面包芒果冰淇淋好吃谢谢你好不用谢对不起]/;

/**
 * Detect and remove Chinese hallucinations (common in Chinese-pretrained LLMs like Qwen).
 * Preserves Korean Hangul, English, and legitimate Japanese Kanji (paired with Kana or in quiz options).
 */
export function stripChineseHallucinations(text: string): string {
  if (!text) return "";
  let s = text;
  let hasReplaced = false;

  // 1. Strip Chinese clauses or sentences starting with Hanzi and containing Chinese indicators
  s = s.replace(/[\u4E00-\u9FFF][\u4E00-\u9FFF\s，。？！、“”‘’…·?!.]*/g, (match) => {
    const trimmed = match.trim();
    if (!trimmed) return match;

    // Must contain at least one Hanzi character to be considered a Chinese clause
    if (!/[\u4E00-\u9FFF]/.test(trimmed)) return match;

    // Preserve if contains any Hangul or Japanese Kana
    const hasHangul = /[\uAC00-\uD7AF\u1100-\u11FF]/.test(trimmed);
    const hasKana = /[\u3040-\u309F\u30A0-\u30FF]/.test(trimmed);
    if (hasHangul || hasKana) return match;

    // Check if matches Chinese indicator characters (e.g. 你, 吗, 喜欢, 面包, 芒果, etc.)
    if (CHINESE_INDICATOR_REGEX.test(trimmed)) {
      hasReplaced = true;
      return " ";
    }

    return match;
  });

  // 2. Also strip isolated single Chinese grammatical characters (e.g. isolated 你, 吗, 欢, etc.)
  s = s.replace(/(?:^|[\s?!.,~…])([你您他她它们这那哪谁什么吗呢吧的得地了着过啊呀没很太真想要喜欢吃喝看听说做让给去来能会欢门关开问经现样题变动点面包芒果冰淇淋好吃谢谢你好不用谢对不起]+)(?:[\s?!.,~…，。？！]|$)/g, (match) => {
    if (/[\uAC00-\uD7AF\u3040-\u30FF]/.test(match)) return match;
    hasReplaced = true;
    return " ";
  });

  if (hasReplaced) {
    s = s.replace(/[ \t]{2,}/g, " ");
  }

  return s;
}

/**
 * Check if a text is predominantly a Chinese hallucination
 */
export function isChineseHallucination(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const hangulMatches = trimmed.match(/[\uAC00-\uD7AF\u1100-\u11FF]/g) || [];
  const kanaMatches = trimmed.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || [];
  const hanziMatches = trimmed.match(/[\u4E00-\u9FFF]/g) || [];

  if (hangulMatches.length > 0 || kanaMatches.length > 0) return false;
  if (hanziMatches.length >= 2 && CHINESE_INDICATOR_REGEX.test(trimmed)) {
    return true;
  }
  return false;
}

export function stripVisualArtifacts(text: string): string {
  let s = text;
  // 0. Markdown dividers (---, ***, ___), double dashes, or separator lines
  s = s.replace(/^[ \t]*[-*_~=]{2,}[ \t]*$/gm, "");
  s = s.replace(/[-*_~=]{3,}/g, " ");
  // 1. Unicode Emojis & Pictographs (including 🎯, 😊, 🐱, etc.)
  s = s.replace(/\p{Extended_Pictographic}/gu, "");
  s = s.replace(/[\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, "");
  // 2. Decorative geometric bullets & symbols
  s = s.replace(/[■□◆◇●○★☆▲△▼▽▶▷◀◁✓✔✗✘✦✧※†‡]/gu, "");
  // 3. Isolated markdown bullets at start of lines
  s = s.replace(/(^|[\n\r])\s*[-*•]\s+/g, "$1");
  return s;
}

export function formatChatText(text: string): string {
  let s = stripVisualArtifacts(text);
  s = stripChineseHallucinations(s);
  // Exclamation & question marks followed by any non-whitespace
  s = s.replace(/([!?！？])([^\s!?！？])/g, "$1 $2");

  // Alphabet quiz options: Only format at line start or after whitespace, matching locale
  s = s.replace(/(^|[\n\r]|\s+)([A-Za-z])[\.\)]\s*([가-힣])/g, "$1$2번, $3");
  s = s.replace(/(^|[\n\r]|\s+)([A-Za-z])[\.\)]\s*([\u3040-\u30ff\u4e00-\u9faf])/g, "$1$2、$3");
  s = s.replace(/(^|[\n\r]|\s+)([A-Za-z])[\.\)]\s*([A-Za-z])/g, "$1$2, $3");

  // Numbered choices: Only at line start or after newline (never in middle of math like 3 * 5 = 15.)
  s = s.replace(/(^|[\n\r])\s*(\d{1,2})[\.\)]\s*([가-힣])/g, "$1$2번, $3");
  s = s.replace(/(^|[\n\r])\s*(\d{1,2})[\.\)]\s*([\u3040-\u30ff\u4e00-\u9faf])/g, "$1$2、$3");
  s = s.replace(/(^|[\n\r])\s*(\d{1,2})[\.\)]\s*([A-Za-z])/g, "$1$2, $3");

  // Space after numbered dot: 1.친구 -> 1. 친구
  s = s.replace(/(^|[\n\r])(\d+[\.\)])([^\s\d])/g, "$1$2 $3");
  // Period followed by letter
  s = s.replace(/([가-힣a-zA-Z\)])\.([가-힣a-zA-Z])/g, "$1. $2");
  return s;
}

export function sanitizeSpeechForTts(text: string): string {
  // 0. Action prose, stage directions, and thoughts inside *...* must NEVER be spoken by TTS!
  let s = text.replace(/\*([^*\n]+)\*/g, (_match, p1) => {
    if (isLikelyActionProse(p1)) return " ";
    return ` ${p1} `;
  });
  s = formatChatText(s);
  // Soften shouting/harsh interjections that cause TTS vocal strain/pitch spikes
  s = s.replace(/와아!+/g, "와아~");
  s = s.replace(/우와!+/g, "우와~");
  s = s.replace(/앗!+/g, "앗,");
  s = s.replace(/야호!+/g, "야호~");
  s = s.replace(/대단해!+/g, "대단해~");
  // Pronounce Japanese words with Korean parenthetical readings cleanly once: ともだち(토모다치) -> 토모다치
  s = s.replace(/[\u3040-\u30ff\u4e00-\u9faf]+\s*\(([가-힣\s]+)\)/g, "$1");
  // Reverse: 친구(ともだち) -> 친구
  s = s.replace(/([가-힣]+)\s*\([\u3040-\u30ff\u4e00-\u9faf\s]+\)/g, "$1");
  // Remove quotation marks that cause awkward glottal stops in TTS, preserving contractions/possessive apostrophes (don't, I'm, let's, Miku's)
  s = s.replace(/(?<![a-zA-Z])['`]/g, "");
  s = s.replace(/['`](?![a-zA-Z])/g, "");
  s = s.replace(/["`“”]/g, "");

  // Convert stiff, flat written-exam question endings into lively conversational questioning
  s = s.replace(/([가-힣]+)인\s*것은\?/g, "$1인 건 뭘까?");
  s = s.replace(/([가-힣]+)는\s*것은\?/g, "$1는 건 뭘까?");
  s = s.replace(/([가-힣]+)한\s*것은\?/g, "$1한 건 뭘까?");
  s = s.replace(/([가-힣]+)을\s*고르시오\.?/g, "$1을 골라봐~");
  s = s.replace(/([가-힣]+)를\s*고르시오\.?/g, "$1를 골라봐~");

  // Soften staccato laugh sounds
  s = s.replace(/에헤헤+/g, "헤헤~");
  s = s.replace(/헤헤헤+/g, "헤헤~");
  s = s.replace(/아하하+/g, "하하~");
  s = s.replace(/히히히+/g, "히히~");
  s = s.replace(/크크크+/g, "후후~");
  s = s.replace(/[ㅋㅎ]+/g, "");

  // Strip repeated dashes / separator residues
  s = s.replace(/-{2,}/g, " ");

  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";

  // Guard: Text must contain at least one readable character (Hangul, alphanumeric, Kana, Hanzi)
  // Isolated punctuation, dividers, or symbol residue (e.g. "---", "...", "~", "!?") must NEVER be sent to TTS!
  if (!/[가-힣a-zA-Z0-9\u3040-\u30ff\u4e00-\u9faf]/.test(s)) {
    return "";
  }

  // Guaranteed terminal sentence punctuation to prevent autoregressive TTS tail hallucinations:
  // Must check if there is ALREADY terminal punctuation, including before closing brackets/quotes!
  const hasTerminalPunct = /[.!?~…\u3002\uFF01\uFF1F][\]』」）)'"”’]*$/.test(s);
  if (!hasTerminalPunct) {
    const isJapaneseEnd = /[\u3040-\u30ff\u4e00-\u9faf][\]』」）)'"”’]*$/.test(s);
    s += isJapaneseEnd ? "。" : ".";
  }

  return s;
}

export function extractConversationalChunks(buf: string): { chunks: string[]; remaining: string } {
  const formatted = formatChatText(buf);
  const chunks: string[] = [];
  // Split strictly on COMPLETE natural sentences (. ! ? ~ … 。 ！？ \n)
  const re = /([^.!?~…\u3002\uFF01\uFF1F\n]+[.!?~…\u3002\uFF01\uFF1F\n]+)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(formatted)) !== null) {
    const s = m[0].trim();
    if (s.length >= 2 && /[가-힣a-zA-Z0-9\u3040-\u30ff\u4e00-\u9faf]/.test(s)) {
      chunks.push(s);
      lastIdx = re.lastIndex;
    }
  }

  return { chunks, remaining: formatted.slice(lastIdx).trim() };
}
