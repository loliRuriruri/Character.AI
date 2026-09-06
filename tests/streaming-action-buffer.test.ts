import assert from "node:assert";
import { StreamingActionSpanBuffer } from "../src/core/response/StreamingActionSpanBuffer";

export function testStreamingActionBuffer() {
  console.log("-> Running tests/streaming-action-buffer.test.ts");

  // 1. Multi-chunk split array
  {
    const chunks = ["*수줍게 ", "시선을 ", "피한다.* ", "응, ", "조금 부끄럽네."];
    const buffer = new StreamingActionSpanBuffer({ mode: "rp" });
    const allActions: string[] = [];
    let fullSpeech = "";

    for (const chunk of chunks) {
      const { completedActions, speechChunk } = buffer.processDelta(chunk);
      allActions.push(...completedActions);
      fullSpeech += speechChunk;
    }
    const flushed = buffer.flush();
    allActions.push(...flushed.remainingActions);
    fullSpeech += flushed.remainingSpeech;

    assert.deepStrictEqual(allActions, ["수줍게 시선을 피한다."]);
    assert(!fullSpeech.includes("수줍"));
    assert(!fullSpeech.includes("시선"));
    assert(!fullSpeech.includes("피한다"));
    assert.strictEqual(fullSpeech.replace(/\s+/g, " ").trim(), "응, 조금 부끄럽네.");
  }

  // 2. Action embedded in middle of sentence
  {
    const chunks = ["안녕. ", "*고개를 ", "살짝 숙이며 ", "미소 짓는다.* ", "오늘도 왔네?"];
    const buffer = new StreamingActionSpanBuffer({ mode: "rp" });
    const allActions: string[] = [];
    let fullSpeech = "";

    for (const chunk of chunks) {
      const { completedActions, speechChunk } = buffer.processDelta(chunk);
      allActions.push(...completedActions);
      fullSpeech += speechChunk;
    }
    const flushed = buffer.flush();
    allActions.push(...flushed.remainingActions);
    fullSpeech += flushed.remainingSpeech;

    assert.deepStrictEqual(allActions, ["고개를 살짝 숙이며 미소 짓는다."]);
    assert.strictEqual(fullSpeech.replace(/\s+/g, " ").trim(), "안녕. 오늘도 왔네?");
  }

  // 3. Unclosed action flushed safely on stream end
  {
    const buffer = new StreamingActionSpanBuffer({ mode: "rp" });
    buffer.processDelta("*수줍게 시선을 피한다");
    const flushed = buffer.flush();
    assert.deepStrictEqual(flushed.remainingActions, ["수줍게 시선을 피한다"]);
    assert.strictEqual(flushed.remainingSpeech, "");
  }

  // 4. Markdown bold not treated as action during stream
  {
    const buffer = new StreamingActionSpanBuffer({ mode: "rp" });
    const { completedActions, speechChunk } = buffer.processDelta("**정말 중요한 공지**");
    assert.deepStrictEqual(completedActions, []);
    assert(speechChunk.includes("**정말 중요한 공지**"));
  }

  console.log("   ✓ StreamingActionSpanBuffer tests passed.");
}
