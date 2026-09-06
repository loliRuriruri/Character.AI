import assert from "node:assert";
import { ResponseParser } from "../src/core/response/ResponseParser";
import { sanitizeSpeechForTts, stripChineseHallucinations, isChineseHallucination } from "../src/core/response/TtsSanitizer";

export function testResponseParser() {
  console.log("-> Running tests/response-parser.test.ts");

  // 1. 단독 행동
  {
    const parsed = ResponseParser.parse("*수줍게 시선을 피한다*", { mode: "rp" });
    assert.deepStrictEqual(parsed.actionCues, ["수줍게 시선을 피한다"]);
    assert.strictEqual(parsed.speechText, "");
    assert.strictEqual(sanitizeSpeechForTts(parsed.speechText), "");
  }

  // 2. 행동 + 대사
  {
    const parsed = ResponseParser.parse("*수줍게 시선을 피한다.* 응... 조금 부끄럽네.", { mode: "rp" });
    assert.deepStrictEqual(parsed.actionCues, ["수줍게 시선을 피한다."]);
    assert.strictEqual(parsed.speechText, "응... 조금 부끄럽네.");
    assert.strictEqual(sanitizeSpeechForTts(parsed.speechText), "응... 조금 부끄럽네.");
  }

  // 3. 모드별 동작 구분
  {
    // RP mode: any non-homonym inside *...* is stage direction
    const rp = ResponseParser.parse("*조용히 웃는다.*", { mode: "rp" });
    assert.deepStrictEqual(rp.actionCues, ["조용히 웃는다."]);
    assert.strictEqual(rp.speechText, "");

    // Chat mode: general markdown emphasis preserved
    const chat = ResponseParser.parse("이건 *정말* 중요해.", { mode: "chat" });
    assert.deepStrictEqual(chat.actionCues, []);
    assert(chat.speechText.includes("정말"));

    // Tutor mode: emphasis preserved
    const tutor = ResponseParser.parse("이 단어는 *절대로* 잊으면 안 돼.", { mode: "tutor" });
    assert.deepStrictEqual(tutor.actionCues, []);
    assert(tutor.speechText.includes("절대로"));
  }

  // 4. False Positive 30개 회귀 테스트 (동음이의어, 코드, 볼드, 수식, 와일드카드, 포인터)
  {
    const fpCases = [
      "*손해*", "*손실*", "*손자*", "*손녀*", "*손님*", "*손목시계*", "*손수건*", "*손재주*", "*빈손*",
      "*눈금*", "*함박눈*", "*첫눈*", "*눈사람*", "*폭설*", "*눈싸움*",
      "*걸그룹*",
      "**절대로 안 돼**", "***정말 중요***",
      "`const ptr = *val;`",
      "3 * 5 * 2 = 30", "a * b * c",
      "*.ts", "*.json", "src/*/*.js",
      "*ptr",
      "*^^*", "*.*",
      "어제 -> 그저께",
      "f***ing",
      "*약속*", "*주의*", "*확인*"
    ];

    for (const text of fpCases) {
      const parsed = ResponseParser.parse(text, { mode: "rp" });
      assert.strictEqual(
        parsed.actionCues.length,
        0,
        `False positive detected for ${text}: ${JSON.stringify(parsed.actionCues)}`
      );
    }
  }

  // 5. Apostrophe 보존
  {
    const en = "I'm sure you don't mind. Let's sing Miku's song!";
    const parsed = ResponseParser.parse(en, { mode: "rp" });
    assert(parsed.speechText.includes("I'm"));
    assert(parsed.speechText.includes("don't"));
    assert(parsed.speechText.includes("Let's"));
    assert(parsed.speechText.includes("Miku's"));

    const clean = sanitizeSpeechForTts(parsed.speechText);
    assert(clean.includes("I'm"));
    assert(clean.includes("don't"));
    assert(clean.includes("Let's"));
    assert(clean.includes("Miku's"));
  }

  // 6. Emoji & Decorative Symbol Stripping (Prevents Fish Audio Chinese Speech Hallucination)
  {
    const text1 = "아! 일본어 퀴즈요청해 주신 마스터! 🎯";
    const clean1 = sanitizeSpeechForTts(text1);
    assert.strictEqual(clean1, "아! 일본어 퀴즈요청해 주신 마스터!");
    assert(!clean1.includes("🎯"));

    const text2 = '질문: "The cat is sleeping on the mat." 이 문장을 일본어로 어떻게 번역할까요? 😊';
    const clean2 = sanitizeSpeechForTts(text2);
    assert(!clean2.includes("😊"));
    assert(!clean2.includes('"'));
    assert.strictEqual(clean2, "질문: The cat is sleeping on the mat. 이 문장을 일본어로 어떻게 번역할까요?");

    const text3 = "★ 미쿠의 추천! ✨ 오늘은 즐거운 날이야~ 🌸 🎯 🐱 👍";
    const clean3 = sanitizeSpeechForTts(text3);
    assert.strictEqual(clean3, "미쿠의 추천! 오늘은 즐거운 날이야~");
  }

  // 7. Locale-Aware Quiz Choice & Numbered Option Normalization
  {
    // Korean choices: "A번, "
    const choicesKo = "A) 사과\nB) 바나나";
    const cleanKo = sanitizeSpeechForTts(choicesKo);
    assert(cleanKo.includes("A번, 사과"));
    assert(cleanKo.includes("B번, 바나나"));

    // Japanese choices: "A、" (MUST NOT insert Korean "번")
    const choicesJa = "A) 猫はベッドで寝ています。\nB) 猫はマット";
    const cleanJa = sanitizeSpeechForTts(choicesJa);
    assert(cleanJa.includes("A、猫はベッドで寝ています。"));
    assert(cleanJa.includes("B、猫はマット。"));
    assert(!cleanJa.includes("A번,"));
    assert(!cleanJa.includes("B번,"));
    assert(cleanJa.endsWith("。"));

    // English choices: "A, "
    const choicesEn = "A) The cat is on the mat.\nB) The dog";
    const cleanEn = sanitizeSpeechForTts(choicesEn);
    assert(cleanEn.includes("A, The cat"));
    assert(cleanEn.includes("B, The dog."));
    assert(!cleanEn.includes("A번,"));

    // Numbered options at line start
    const numbered = "1. 사과\n2. 바나나\n3. 포도";
    const cleanNum = sanitizeSpeechForTts(numbered);
    assert(cleanNum.includes("1번, 사과"));
    assert(cleanNum.includes("2번, 바나나"));
    assert(cleanNum.includes("3번, 포도"));
  }

  // 8. Closing Quotes & Brackets Terminal Punctuation (Zero Duplicate Punctuation)
  {
    // Existing punctuation inside/before quotes or brackets must NOT get extra periods
    assert.strictEqual(sanitizeSpeechForTts('"안녕!"'), "안녕!");
    assert.strictEqual(sanitizeSpeechForTts("'hello?'"), "hello?");
    assert.strictEqual(sanitizeSpeechForTts("「猫です。」"), "「猫です。」");
    assert.strictEqual(sanitizeSpeechForTts("（大丈夫。）"), "（大丈夫。）");
    assert.strictEqual(sanitizeSpeechForTts("안녕!"), "안녕!");
    assert.strictEqual(sanitizeSpeechForTts("hello?"), "hello?");
    assert.strictEqual(sanitizeSpeechForTts("猫です。"), "猫です。");
    assert.strictEqual(sanitizeSpeechForTts("大丈夫。"), "大丈夫。");

    // Sentences lacking terminal punctuation get cleanly punctuated
    assert.strictEqual(sanitizeSpeechForTts("안녕하세요 마스터"), "안녕하세요 마스터.");
    assert.strictEqual(sanitizeSpeechForTts("こんにちは、マスター"), "こんにちは、マスター。");
  }

  // 9. Idempotency Property Test: sanitize(sanitize(x)) === sanitize(x) (34 Diverse Strings)
  {
    const testStrings = [
      "안녕하세요 마스터!",
      "오늘 날씨가 정말 좋네요.",
      "Hello! How are you doing today?",
      "こんにちは、マスター！",
      "A) 사과\nB) 바나나",
      "1. 첫 번째 2. 두 번째",
      "와아아아!! 대단해!!",
      "헤헤헤~ 고마워!",
      "I'm sure you don't mind. Let's go!",
      "친구(ともだち)와 함께 놀자.",
      "ともだち(토모다치)랑 놀자.",
      "이것은 '인용문'입니다.",
      "\"따옴표\" 테스트",
      "3 * 5 = 15",
      "c = a * b",
      "f***ing amazing",
      "질문: \"The cat is sleeping on the mat.\" 번역해줘",
      "A) 猫はベッドで寝ています。\nB) 猫はマット",
      "1. 사과\n2. 바나나\n3. 포도",
      "★ 미쿠의 추천! ✨ 오늘은 즐거운 날이야~ 🌸",
      "안녕",
      "こんにちは",
      "Hello",
      "「猫です。」",
      "（大丈夫。）",
      "정말... 그렇게 생각해?",
      "에헤헤헤... 조금 부끄러워",
      "앗! 깜짝이야!",
      "야호!! 신난다!!",
      "123.456 숫자는 그대로 유지되어야 해.",
      "Mr. Smith went to Washington.",
      "2026.09.06 날짜 형식",
      "마스터, 오늘 기분은 어때? 내일 내일만 내다보느라 바쁘지 않았어?",
      "나도 오늘 아침에 일어나자마자 마스터를 만나서 반가웠어."
    ];

    for (let i = 0; i < testStrings.length; i++) {
      const original = testStrings[i];
      const once = sanitizeSpeechForTts(original);
      const twice = sanitizeSpeechForTts(once);
      assert.strictEqual(
        once,
        twice,
        `Idempotency failed on case [${i + 1}]: "${original}" -> 1st: "${once}" vs 2nd: "${twice}"`
      );
    }
  }

  // 12. Reasoning Tags (<think> / <thought>) complete stripping test
  {
    const rawWithThink = "<think>\nThinking in Chinese: 用户问我今天过得怎么样...\n</think>\n*밝게 웃으며* 안녕하세요! 오늘 하루 즐겁게 보내셨나요?";
    const parsed = ResponseParser.parse(rawWithThink, { mode: "rp" });
    assert(!parsed.raw.includes("<think>"), "Raw should strip think tags in parse");
    assert(!parsed.displayProse.includes("Thinking in Chinese"));
    assert(!parsed.speechText.includes("Thinking in Chinese"));
    assert.deepStrictEqual(parsed.actionCues, ["밝게 웃으며"]);
    assert.strictEqual(parsed.speechText, "안녕하세요! 오늘 하루 즐겁게 보내셨나요?");
  }

  // 13. Quiz questions and choices inside asterisks must NOT be classified as action cues, and must be spoken by TTS
  {
    const quizRaw = '* "私はコーヒーを飲みました"에서 "を"는 어떤 조사? ① 도구/수단 ② 목적어(을/를) ③ 출발점 ④ 장소 *';
    const parsedTutor = ResponseParser.parse(quizRaw, { mode: "tutor" });
    assert.deepStrictEqual(parsedTutor.actionCues, [], "Quiz question should not be classified as action cue");
    assert(parsedTutor.speechText.includes("私はコーヒーを飲みました"));
    assert(parsedTutor.speechText.includes("어떤 조사"));
    const cleanSpeech = sanitizeSpeechForTts(parsedTutor.speechText);
    assert(cleanSpeech.includes("어떤 조사"));

    const quizRp = ResponseParser.parse(quizRaw, { mode: "rp" });
    assert.deepStrictEqual(quizRp.actionCues, [], "Quiz should not be an action cue even in RP mode");
  }

  // 14. Dividers and punctuation-only strings must return empty string (prevents TTS ghost laugh hallucinations)
  {
    assert.strictEqual(sanitizeSpeechForTts("---"), "");
    assert.strictEqual(sanitizeSpeechForTts("---."), "");
    assert.strictEqual(sanitizeSpeechForTts("***"), "");
    assert.strictEqual(sanitizeSpeechForTts("___"), "");
    assert.strictEqual(sanitizeSpeechForTts("..."), "");
    assert.strictEqual(sanitizeSpeechForTts("~~~"), "");
    assert.strictEqual(sanitizeSpeechForTts("   "), "");
    assert.strictEqual(sanitizeSpeechForTts("--"), "");
  }

  // 15. Chinese Hallucination Detection & Stripping (e.g. Qwen slipping into Chinese)
  {
    const userExample = "*웃으면서 편의점 냉동실을 열어 아이스크림을 꺼내준다.* 여기, 마스터가 좋아할 만한 아이스크림이야~! 어떤 맛이 좋을까? 芒果面包你喜欢吗？";
    const parsed = ResponseParser.parse(userExample, { mode: "rp" });
    assert.deepStrictEqual(parsed.actionCues, ["웃으면서 편의점 냉동실을 열어 아이스크림을 꺼내준다."]);
    assert(!parsed.speechText.includes("芒果"));
    assert(!parsed.speechText.includes("面包"));
    assert(!parsed.speechText.includes("你喜欢吗"));
    assert.strictEqual(parsed.speechText, "여기, 마스터가 좋아할 만한 아이스크림이야~! 어떤 맛이 좋을까?");
    assert.strictEqual(sanitizeSpeechForTts(parsed.speechText), "여기, 마스터가 좋아할 만한 아이스크림이야~! 어떤 맛이 좋을까?");

    // Pure Chinese hallucination response
    const pureZh = "好的，这是你要的冰淇淋！你想吃什么？";
    assert(isChineseHallucination(pureZh));
    const strippedPureZh = stripChineseHallucinations(pureZh).trim();
    assert.strictEqual(strippedPureZh, "");

    // Chinese sentence in the middle
    const midZh = "여기 芒果面包 맛있는 아이스크림이야!";
    const strippedMidZh = stripChineseHallucinations(midZh);
    assert(!strippedMidZh.includes("芒果面包"));
    assert(strippedMidZh.includes("여기"));
    assert(strippedMidZh.includes("맛있는 아이스크림이야!"));
  }

  // 16. Legitimate Japanese Kanji and Korean Hangul must NEVER be stripped by Chinese filter
  {
    // Japanese with Kanji and Kana
    const jaText = "初音ミクです。今日もよろしくね！";
    assert(!isChineseHallucination(jaText));
    assert.strictEqual(stripChineseHallucinations(jaText).trim(), jaText);

    // Japanese quiz multiple choices with Kanji
    const quizChoices = "① 友達  ② 家族  ③ 先生  ④ 学校";
    assert(!isChineseHallucination(quizChoices));
    assert.strictEqual(stripChineseHallucinations(quizChoices).trim(), quizChoices);

    // Japanese word with parenthetical Hangul reading
    const jpKo = "リンゴ(사과)를 먹었어";
    assert(!isChineseHallucination(jpKo));
    assert.strictEqual(stripChineseHallucinations(jpKo).trim(), jpKo);
  }

  console.log("   ✓ ResponseParser tests passed.");
}
