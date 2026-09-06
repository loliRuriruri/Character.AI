export function formatChatText(text: string): string {
  let s = text;
  // Exclamation & question marks followed by any non-whitespace
  s = s.replace(/([!?])([^\s])/g, "$1 $2");
  // Numbered choices glued to preceding text: e.g. 친구2. -> 친구\n2.
  s = s.replace(/([가-힣a-zA-Z\)])(\d+[\.\)])/g, "$1\n$2");
  // Space after numbered dot: 1.친구 -> 1. 친구
  s = s.replace(/(\d+[\.\)])([^\s\d])/g, "$1 $2");
  // Separate choice ending from prompt: 4. 노래정답을 -> 4. 노래\n정답을
  s = s.replace(/(\d+\.\s*[가-힣a-zA-Z]+)(정답|골라|맞혀|도전)/g, "$1\n$2");
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
  s = s.replace(/(^|[\s(])['"`“‘]([가-힣a-zA-Z0-9])/g, "$1$2");
  s = s.replace(/([가-힣a-zA-Z0-9])['"`”’]([\s).,!?]|$)/g, "$1$2");
  s = s.replace(/["`“”]/g, "");
  // Numbered options read cleanly with pausing commas: 1. 친구 -> 1번, 친구.
  s = s.replace(/(\d+)\.\s*([가-힣a-zA-Z]+)/g, "$1번, $2. ");
  // Soften staccato laugh sounds
  s = s.replace(/에헤헤+/g, "헤헤~");
  s = s.replace(/헤헤헤+/g, "헤헤~");
  s = s.replace(/아하하+/g, "하하~");
  s = s.replace(/히히히+/g, "히히~");
  s = s.replace(/크크크+/g, "후후~");
  s = s.replace(/[ㅋㅎ]+/g, "");
  return s.replace(/\s+/g, " ").trim();
}

export function extractConversationalChunks(buf: string): { chunks: string[]; remaining: string } {
  const formatted = formatChatText(buf);
  const chunks: string[] = [];
  // Split strictly on COMPLETE natural sentences (. ! ? \n) - Never split on commas or word middles!
  const re = /([^.!?\n]+[.!?\n]+)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(formatted)) !== null) {
    const s = m[0].trim();
    if (s.length >= 2) {
      chunks.push(s);
      lastIdx = re.lastIndex;
    }
  }

  return { chunks, remaining: formatted.slice(lastIdx) };
}
