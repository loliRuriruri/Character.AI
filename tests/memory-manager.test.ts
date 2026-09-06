import assert from "node:assert";
import { MemoryManager } from "../src/core/memory/MemoryManager";

export function testMemoryManager() {
  console.log("-> Running tests/memory-manager.test.ts");

  const mgr = new MemoryManager({
    maxContextTokens: 8192,
    keepRecentTurns: 4,
  });

  // 1. Fact deduplication
  mgr.mergeFact("사용자는 고양이를 좋아함");
  mgr.mergeFact("사용자는 고양이를 좋아함.");
  mgr.mergeFact("사용자는 고양이를 좋아함");
  const mem1 = mgr.getMemory();
  const catFacts = mem1.facts.filter(f => f.includes("고양이"));
  assert.strictEqual(catFacts.length, 1, "Duplicate facts must be merged to 1");

  // 2. Contradiction handling: newer fact replaces older contradiction
  mgr.mergeFact("사용자는 민트초코를 좋아함");
  assert(mgr.getMemory().facts.some(f => f.includes("좋아함")));
  mgr.mergeFact("사용자는 민트초코를 싫어함");
  const mintFacts = mgr.getMemory().facts.filter(f => f.includes("민트초코"));
  assert.strictEqual(mintFacts.length, 1, "Contradicting facts must supersede");
  assert(mintFacts[0].includes("싫어함"), "Newer fact must take precedence");

  // 3. Promise completion
  mgr.mergePromise("내일 함께 산책하기로 약속함");
  const mem2 = mgr.getMemory();
  assert(mem2.promises.some(p => p.includes("산책")));
  mgr.mergePromise("산책하기로 약속 완료");
  const mem3 = mgr.getMemory();
  const activePromises = mem3.structuredPromises?.filter(p => p.status === "active");
  const completedPromises = mem3.structuredPromises?.filter(p => p.status === "completed");
  assert(completedPromises && completedPromises.length > 0, "Promise should be marked completed");

  // 4. Open thread resolution
  mgr.mergeOpenThread("주말에 볼 영화 추천");
  mgr.mergeOpenThread("주말 영화 추천 해결 완료");
  const mem4 = mgr.getMemory();
  const resolvedThreads = mem4.structuredThreads?.filter(t => t.status === "resolved");
  assert(resolvedThreads && resolvedThreads.length > 0, "Thread should be resolved");

  // 5. JSON parsing & fallback
  const validJson = "```json\n" +
    JSON.stringify({
      summary: "우리는 음악에 대해 이야기를 나누었다.",
      facts: ["사용자는 록 음악을 좋아함"],
      relationship: "음악 취향을 공유하는 절친한 사이",
      promises: ["다음 주에 보컬로이드 신곡 들려주기"],
      openThreads: ["최고의 일렉트릭 기타 브랜드"]
    }, null, 2) + "\n```";
  const parsed = MemoryManager.parseSummaryJson(validJson);
  assert(parsed !== null);
  assert.strictEqual(parsed?.summary, "우리는 음악에 대해 이야기를 나누었다.");
  assert.deepStrictEqual(parsed?.facts, ["사용자는 록 음악을 좋아함"]);

  // Malformed JSON fallback check
  const malformed = "{ summary: unquoted syntax error }";
  assert.strictEqual(MemoryManager.parseSummaryJson(malformed), null);

  // 6. Deep structured fast pruning fallback
  mgr.addMessage({ role: "user", content: "안녕 미쿠! 오늘 날씨가 정말 좋아." });
  mgr.addMessage({ role: "assistant", content: "응! 햇살이 따스해서 기분이 상쾌해." });
  mgr.addMessage({ role: "user", content: "나는 피아노 치는 걸 좋아해. 다음에 꼭 들려줄게!" });
  mgr.addMessage({ role: "assistant", content: "와아! 멋지다, 꼭 듣고 싶어!" });
  mgr.addMessage({ role: "user", content: "그런데 어떤 곡을 좋아해?" });
  mgr.addMessage({ role: "assistant", content: "나는 템포가 빠른 팝송을 좋아해!" });
  mgr.addMessage({ role: "user", content: "최근 턴 1" });
  mgr.addMessage({ role: "assistant", content: "최근 턴 2" });
  mgr.addMessage({ role: "user", content: "최근 턴 3" });
  mgr.addMessage({ role: "assistant", content: "최근 턴 4" });

  mgr.applyFastPruning();
  const prunedMem = mgr.getMemory();
  assert(prunedMem.rollingSummary.length > 0, "Summary must be populated");
  assert(prunedMem.facts.some(f => f.includes("피아노")), "User hobby fact must be captured");

  console.log("   ✓ MemoryManager tests passed.");
}
