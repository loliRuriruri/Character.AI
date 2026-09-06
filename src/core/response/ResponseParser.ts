import type { ParsedAssistantResponse } from "../character/types";

// Matches [[emotion:happy]], [emotion: happy], etc.
const EMOTION_TAG_REGEX = /(?:\*\*|\*|[`\[]*)?\[\[?\s*(?:emotion\s*:\s*)?([a-zA-Z가-힣_]+)\s*\]\]?(?:\*\*|\*|[`\]]*)?/gi;

// Action keywords for Korean RP / Stage directions (Compound roots to avoid homonym nouns like 손해, 눈금, 걸그룹)
export const ACTION_KEYWORD_REGEX = /(?:끄덕|흔들|웃|미소\s*짓|미소\s*지|미소짓|미소를|살며시\s*미소|환한\s*미소|바라|눈을\s*깜빡|눈\s*깜빡|눈을\s*동그|눈\s*반짝|눈을\s*감|눈\s*마주|눈물|눈빛|눈웃음|손을\s*흔들|손\s*흔들|손짓|손인사|손을\s*번쩍|두\s*손|손가락|손총|손뼉|손을\s*잡|손잡|손으로|손을\s*뻗|손을\s*올려|손을\s*모아|고개를\s*끄덕|고개\s*끄덕|고개를\s*숙|고개\s*숙|고개\s*갸우뚱|고개\s*돌려|고개\s*흔들|발걸음|걸어|다가|서서|앉|표정|인사|살며시|조용히|활짝|신나|당황|놀라|속삭|가리|포즈|점프|박수|안아|쓰다듬|건네|잡|기울|깜빡|빵야|회전|뛰|움찔|갸우뚱|글썽|한숨|바라보|마주|달려|두리번|기지개|토닥|쳐다|응시|주먹|총|윙크|살짝|부끄|수줍|웅얼|멍하니|골똘|흥얼|노래|춤|끄덕이|건넨다|건네며|바라본다|바라보며|바라보곤|웃음|기쁨|놀람|슬픔|화남|분노|안도|보며|보인다|짓는다|흔든다|숙인다|돌린다)/;

// Pure emphasis words and common homonym nouns that should NOT be treated as actions even if enclosed in *...*
export const NON_ACTION_EMPHASIS_REGEX = /^(?:절대로|정말(?:로)?|진짜(?:로)?|반드시|꼭|너무|매우|약속|주의|중요|참고|확인|경고|오타|수정|손해|손실|손자|손녀|손님|손목시계|손수건|손재주|빈손|눈금|함박눈|첫눈|눈사람|폭설|눈싸움|걸그룹)$/;

export function isLikelyActionProse(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 250) return false;
  // Pure numbers, math, or punctuation
  if (/^[\d\s+\-*/=.,<>]+$/.test(trimmed)) return false;
  // File wildcard extensions (*.ts, *.json) or pointer identifiers (*ptr)
  if (/^\.[a-zA-Z0-9]+$/.test(trimmed)) return false;
  if (/^[a-zA-Z_]\w*$/.test(trimmed)) return false;
  // Known non-action emphasis words and nouns (e.g. *손해*, *눈금*, *걸그룹*)
  if (NON_ACTION_EMPHASIS_REGEX.test(trimmed)) return false;
  // Arrow corrections like "어제 -> 그저께"
  if (/->|=>|→/.test(trimmed)) return false;

  // 1. In character dialogue, any multi-word sentence/phrase (containing spaces) with Korean or CJK text
  // inside *...* represents stage directions, actions, or thoughts (e.g. "*가느다란 미소와 함께 눈이 반짝거린다.*")
  if (trimmed.includes(" ") && /[가-힣\u3040-\u30ff\u4e00-\u9faf]/.test(trimmed)) {
    return true;
  }

  // 2. Contains action roots
  if (ACTION_KEYWORD_REGEX.test(trimmed)) return true;

  // 3. Narrative verbal connective endings (strip trailing punctuation first to match ".!?~…")
  const stripped = trimmed.replace(/[.!?~…\s]+$/, "");
  if (/[가-힣]+(?:며|면서|고|듯|다|어|아|포즈|중|임|음|함|람|림|감|잠|척)$/.test(stripped) && stripped.length >= 2) {
    return true;
  }

  // 4. Reflective thought endings (e.g. *어쩌지?*, *어떨까...*, *뭘까*)
  if (/[가-힣]+(?:지|까|나|걸|텐데|려나|을까|ㄹ까)$/.test(stripped) && stripped.length >= 2) {
    return true;
  }

  return false;
}

export interface ResponseParserOptions {
  mode?: "rp" | "chat" | "tutor" | "free";
}

export class ResponseParser {
  /**
   * 완전한 문장 또는 응답 텍스트를 발화 대사와 행동 서술로 분리
   */
  static parse(raw: string, options?: ResponseParserOptions): ParsedAssistantResponse {
    if (!raw) {
      return {
        raw: "",
        speechText: "",
        displayProse: "",
        actionCues: [],
      };
    }

    const actionCues: string[] = [];

    // 0. 생각 태그 (<think>...</think>, <thought>...</thought>) 완전 제거
    const cleanNoThink = raw.replace(/<(?:think|thought)>[\s\S]*?(?:<\/(?:think|thought)>|$)/gi, "").trim();

    // 1. 감정 태그 제거한 displayProse
    const displayProse = cleanNoThink.replace(EMOTION_TAG_REGEX, "").trim();

    // 2. 보호 패스: 코드블록, 인라인코드, 마크다운 볼드, 수식, 와일드카드, 이모티콘 등
    const protections: string[] = [];
    const protect = (str: string): string => {
      const placeholder = `__PROTECTED_${protections.length}__`;
      protections.push(str);
      return placeholder;
    };

    let text = cleanNoThink.replace(EMOTION_TAG_REGEX, " ");

    // 2.1 코드 블록 (``` ... ```)
    text = text.replace(/```[\s\S]*?```/g, (m) => protect(m));

    // 2.2 인라인 코드 (` ... `)
    text = text.replace(/`[^`\n]+`/g, (m) => protect(m));

    // 2.3 파일 와일드카드 (*.ts, src/*/*.js, test_*.js)
    text = text.replace(/(?:^|[\s(])(\*\.[a-zA-Z0-9]{1,10})/g, (m, p1) => {
      return m.replace(p1, protect(p1));
    });
    text = text.replace(/([a-zA-Z0-9_-]+\/\*[a-zA-Z0-9_./-]*)/g, (m) => protect(m));
    text = text.replace(/([a-zA-Z0-9_-]+\*[a-zA-Z0-9_-]*\.[a-zA-Z0-9]+)/g, (m) => protect(m));

    // 2.4 수식 곱셈 (숫자 * 숫자 또는 영문 변수 * 변수)
    text = text.replace(/(\d+(?:\.\d+)?\s*\*\s*\d+(?:\.\d+)?(?:\s*\*\s*\d+(?:\.\d+)?)*)/g, (m) => protect(m));
    text = text.replace(/([a-zA-Z_]\w*\s*\*\s*[a-zA-Z_]\w*(?:\s*\*\s*[a-zA-Z_]\w*)*)/g, (m) => protect(m));

    // 2.5 마크다운 볼드/볼드이탤릭 (***...*** 또는 **...**)
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, (_m, p1) => protect(p1));
    text = text.replace(/\*\*([^*]+)\*\*/g, (_m, p1) => protect(p1));

    // 2.6 불릿 리스트 (* 항목)
    text = text.replace(/(?:^|\n)\s*\*\s+/g, (m) => protect(m));

    // 2.7 별표 이모티콘 (*^^*, *.*)
    text = text.replace(/\*[\^._~-]+\*/g, (m) => protect(m));

    // 2.8 단어 내부 별표 마스킹 (f***)
    text = text.replace(/[a-zA-Z가-힣]\*{2,}[a-zA-Z가-힣]*/g, (m) => protect(m));

    // 3. 별표 행동 서술 (*action prose*) 판별 및 추출
    // 일반 괄호((...)) 기반 파싱은 비활성화하여 오탐을 방지함
    text = text.replace(/\*([^*\n]+)\*/g, (_match, p1) => {
      const trimmed = p1.trim();
      const isAction = options?.mode === "rp"
        ? (!NON_ACTION_EMPHASIS_REGEX.test(trimmed) && !/^[\d\s+\-*/=.,<>]+$/.test(trimmed) && trimmed.length >= 2)
        : isLikelyActionProse(trimmed);

      if (isAction) {
        actionCues.push(trimmed);
        return " "; // 발화문에서는 제거
      }
      // 행동 서술이 아닌 일반 강조(*절대로*)는 별표만 제거하고 텍스트 유지
      return ` ${trimmed} `;
    });

    // 4. 보호된 토큰 복원
    for (let i = 0; i < protections.length; i++) {
      const placeholder = `__PROTECTED_${i}__`;
      text = text.replace(placeholder, () => protections[i]);
    }

    // 5. 발화 대사(Speech) 정제 (단어 내부 아포스트로피 don't, I'm, let's, Miku's 보존, 외부 따옴표만 제거)
    let speech = text
      .replace(/(^|[\s(])['"`“‘]([가-힣a-zA-Z0-9])/g, "$1$2")
      .replace(/([가-힣a-zA-Z0-9])['"`”’]([\s).,!?]|$)/g, "$1$2")
      .replace(/["`“”]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // 6. 가독성 및 호흡용 문장부호 공백 정규화
    speech = speech
      .replace(/([!?])([^\s])/g, "$1 $2")
      .replace(/([가-힣a-zA-Z\)])\.([가-힣a-zA-Z])/g, "$1. $2");

    return {
      raw: cleanNoThink,
      speechText: speech,
      displayProse,
      actionCues,
    };
  }

  /**
   * 스트리밍 문장 청크에서 TTS 전송용 순수 대사만 추출
   */
  static extractSpeechOnly(chunk: string): string {
    return this.parse(chunk).speechText;
  }
}
