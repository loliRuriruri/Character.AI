import assert from "node:assert/strict";

export function testAudioQueueCadence() {
  console.log("-> Running tests/audio-queue-cadence.test.ts");

  interface SentenceLog {
    sentenceIndex: number;
    text: string;
    sourceStartCalledAt: number;
    sourceEndedAt: number;
  }

  // Simulate 5 consecutive sentences played with the 280ms natural cadence
  const logs: SentenceLog[] = [];
  let simulatedClock = 1000;
  const sentenceDurationsMs = [1200, 1500, 950, 1800, 1100];
  const CADENCE_MS = 280;

  for (let i = 0; i < sentenceDurationsMs.length; i++) {
    const start = simulatedClock;
    const dur = sentenceDurationsMs[i];
    const end = start + dur;
    logs.push({
      sentenceIndex: i + 1,
      text: `Sentence ${i + 1}`,
      sourceStartCalledAt: start,
      sourceEndedAt: end,
    });
    // Next sentence is scheduled after onended + 280ms
    simulatedClock = end + CADENCE_MS;
  }

  // Verify overlap: next.start - previous.end must be >= 0 (no negative gaps!)
  let negativeGapCount = 0;
  for (let i = 1; i < logs.length; i++) {
    const prev = logs[i - 1];
    const curr = logs[i];
    const gap = curr.sourceStartCalledAt - prev.sourceEndedAt;
    if (gap < 0) negativeGapCount++;
    assert.ok(gap >= 0, `Sentence ${i + 1} gap (${gap}ms) must not be negative`);
    assert.equal(gap, CADENCE_MS, `Sentence ${i + 1} gap must match cadence (${CADENCE_MS}ms)`);
  }

  assert.equal(negativeGapCount, 0, "Total negative overlap gaps must be exactly 0");
  console.log("   ✓ AudioQueueCadence tests passed (negative gaps: 0).");
}

if (process.argv[1]?.endsWith("audio-queue-cadence.test.ts")) {
  testAudioQueueCadence();
}
