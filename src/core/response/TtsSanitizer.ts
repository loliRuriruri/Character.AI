export function stripVisualArtifacts(text: string): string {
  let s = text;
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
  let s = formatChatText(text);
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

  // Soften staccato laugh sounds
  s = s.replace(/에헤헤+/g, "헤헤~");
  s = s.replace(/헤헤헤+/g, "헤헤~");
  s = s.replace(/아하하+/g, "하하~");
  s = s.replace(/히히히+/g, "히히~");
  s = s.replace(/크크크+/g, "후후~");
  s = s.replace(/[ㅋㅎ]+/g, "");

  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";

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
