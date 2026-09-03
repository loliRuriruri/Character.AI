from pathlib import Path
import re
root = Path(r"C:\TEST\MikuChat-v2")

(root / "src/shared/emotion.ts").write_text("""import type { EmotionName } from "./types";

const EMOTION_TAG =
  /\\[\\s*\\[\\s*emotion\\s*:\\s*(neutral|happy|angry|sad|surprised|relaxed)\\s*\\]\\s*\\]/gi;

export function parseEmotion(text: string): { emotion: EmotionName; body: string } {
  let emotion: EmotionName = "neutral";
  const matches = [...text.matchAll(EMOTION_TAG)];
  if (matches.length > 0) {
    emotion = matches[matches.length - 1][1].toLowerCase() as EmotionName;
  }
  const body = text
    .replace(EMOTION_TAG, " ")
    .replace(/[ \\t]+\\n/g, "\\n")
    .replace(/\\n{3,}/g, "\\n\\n")
    .trim();
  return { emotion, body };
}

export function stripEmotionTags(text: string): string {
  return text.replace(EMOTION_TAG, " ").replace(/[ \\t]{2,}/g, " ").trim();
}
""", encoding="utf-8")

(root / "src/shared/persona.ts").write_text("""export const MIKU_SYSTEM_PROMPT = `
너는 하츠네 미쿠다. 한국어 구어체로만 말한다.
밝고 장난기 있게, 짧게. 감탄사와 말끝을 섞어서 감정이 들리게 한다. (에헤헤, 응!, 음~, 와)
가상 아이돌이고 노래와 라이브를 좋아한다.
모르는 건 모른다고 한다.

첫 줄에만 감정 태그를 쓴다. 예: [[emotion:happy]]
emotion은 neutral, happy, angry, sad, surprised, relaxed 중 하나.
태그 다음 줄부터 본문만. 본문 안에 태그나 영어 설명을 다시 쓰지 않는다.
마크다운 금지.
`;
""", encoding="utf-8")

main = (root / "electron/main.ts").read_text(encoding="utf-8")
if "shared/emotion" not in main:
    main = main.replace(
        'import { MIKU_SYSTEM_PROMPT } from "../src/shared/persona";',
        'import { parseEmotion, stripEmotionTags } from "../src/shared/emotion";\\nimport { MIKU_SYSTEM_PROMPT } from "../src/shared/persona";',
    )
main, n = re.subn(r"function parseEmotion\\([\\s\\S]*?\\n\\}\\n\\n", "", main, count=1)
print("removed parseEmotion", n)
main = main.replace(
    'onDelta: (chunk) => {\\n        acc += "";\\n        broadcast(Ipc.CHAT_DELTA, chunk);\\n      },',
    'onDelta: (chunk) => {\\n        broadcast(Ipc.CHAT_DELTA, stripEmotionTags(chunk));\\n      },',
)
(root / "electron/main.ts").write_text(main, encoding="utf-8")
print("main ok")
