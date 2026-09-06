import { testResponseParser } from "./response-parser.test";
import { testStreamingActionBuffer } from "./streaming-action-buffer.test";
import { testGestureMapping } from "./gesture-mapping.test";
import { testDynamicContext } from "./dynamic-context.test";
import { testMemoryManager } from "./memory-manager.test";
import { testSceneState } from "./scene-state.test";
import { testPromptComposer } from "./prompt-composer.test";
import { testProviderHealth } from "./provider-health.test";
import { testAudioRms } from "./audio-rms.test";
import { testAudioStopRace } from "./audio-stop-race.test";
import { testAudioQueueCadence } from "./audio-queue-cadence.test";
import { testMotionDirectorClamp } from "./motion-director-clamp.test";

console.log("==================================================");
console.log("       MikuChat-v3 Formal Test Suite Runner       ");
console.log("==================================================");

const suites = [
  { name: "ResponseParser & Sanitizer", fn: testResponseParser },
  { name: "StreamingActionSpanBuffer", fn: testStreamingActionBuffer },
  { name: "GestureMapping & Semantics", fn: testGestureMapping },
  { name: "DynamicContext Capabilities", fn: testDynamicContext },
  { name: "MemoryManager Structured Rolling", fn: testMemoryManager },
  { name: "Dynamic SceneState & Patching", fn: testSceneState },
  { name: "PromptComposer & Late AuthorNote", fn: testPromptComposer },
  { name: "ProviderHealth Monitor", fn: testProviderHealth },
  { name: "Audio RMS Math & Thresholds", fn: testAudioRms },
  { name: "Audio Stop Race & Identity Token Guard", fn: testAudioStopRace },
  { name: "Audio Queue & 280ms Cadence Overlap", fn: testAudioQueueCadence },
  { name: "MotionDirector Clamp & Mocap Binding", fn: testMotionDirectorClamp },
];

let passed = 0;
let failed = 0;

for (const s of suites) {
  try {
    s.fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`❌ ${s.name} FAILED:`, err);
  }
}

console.log("==================================================");
console.log(`Test Summary: ${passed} passed, ${failed} failed out of ${suites.length} suites.`);
console.log("==================================================");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("🎉 ALL FORMAL TEST SUITES PASSED CLEANLY!");
  process.exit(0);
}
