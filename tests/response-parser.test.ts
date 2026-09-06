import assert from "node:assert";
import { ResponseParser } from "../src/core/response/ResponseParser";
import { sanitizeSpeechForTts } from "../src/core/response/TtsSanitizer";

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

  // 7. Quiz Choice & Numbered Option Normalization
  {
    const choices = "A) 猫はベッドで寝ています。\nB) 猫はマット";
    const cleanChoices = sanitizeSpeechForTts(choices);
    assert(cleanChoices.includes("A번,"));
    assert(cleanChoices.includes("B번,"));
    // Must end with clean terminal punctuation for EOS
    assert(cleanChoices.endsWith("。") || cleanChoices.endsWith("."));

    const numbered = "1. 사과\n2. 바나나\n3. 포도";
    const cleanNum = sanitizeSpeechForTts(numbered);
    assert(cleanNum.includes("1번, 사과"));
    assert(cleanNum.includes("2번, 바나나"));
    assert(cleanNum.includes("3번, 포도"));
  }

  // 8. Terminal Punctuation Guarantee (Prevents Autoregressive Tail Hallucination / Screams / Groans)
  {
    const noPunctKo = "안녕하세요 마스터";
    assert.strictEqual(sanitizeSpeechForTts(noPunctKo), "안녕하세요 마스터.");

    const noPunctJa = "こんにちは、マスター";
    assert.strictEqual(sanitizeSpeechForTts(noPunctJa), "こんにちは、マスター。");

    const alreadyPunct = "기다려줘!";
    assert.strictEqual(sanitizeSpeechForTts(alreadyPunct), "기다려줘!");
  }

  console.log("   ✓ ResponseParser tests passed.");
}
