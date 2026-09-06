import assert from "node:assert";
import { SceneStateManager } from "../src/core/memory/SceneStateManager";

export function testSceneState() {
  console.log("-> Running tests/scene-state.test.ts");

  const manager = new SceneStateManager({ location: "디지털 스튜디오" });

  // 1. Location patch from user dialogue
  manager.processTurn("우리 바닷가 카페로 가자");
  assert.strictEqual(manager.getState().location, "바닷가 카페");

  // 2. Posture patch from action cues
  manager.processTurn("잠시 쉬자", "", ["*바닥에 편하게 앉는다*"]);
  assert.strictEqual(manager.getState().posture, "sitting");

  // 3. Emotion and Gaze patch from action cues
  manager.processTurn("", "", ["*수줍게 시선을 피한다*"]);
  assert.strictEqual(manager.getState().characterEmotion, "relaxed");
  assert.strictEqual(manager.getState().gazeTarget, "away");

  // 4. Incremental patch application keeps previous fields
  manager.applyPatch({ posture: "standing" });
  const s = manager.getState();
  assert.strictEqual(s.posture, "standing");
  assert.strictEqual(s.location, "바닷가 카페", "Previous location must be retained");
  assert.strictEqual(s.gazeTarget, "away", "Previous gazeTarget must be retained");

  console.log("   ✓ SceneState tests passed.");
}
