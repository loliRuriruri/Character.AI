import assert from "node:assert";
import { ActionInterpreter } from "../src/core/response/ActionInterpreter";
import type { GestureName } from "../src/shared/types";

export function testGestureMapping() {
  console.log("-> Running tests/gesture-mapping.test.ts");

  // 1. Shy mapping audit: No awkward gestures like think/wave!
  {
    const req = ActionInterpreter.interpret(["수줍게 시선을 피한다"], "");
    assert.strictEqual(req.gesture, null, "Shy gesture must be null to prevent awkward think/wave substitution");
    assert.strictEqual(req.emotion, "relaxed");
    assert.strictEqual(req.expression, "embarrassed");
    assert.strictEqual(req.gaze, "away");
  }

  // 2. Semantic matching for core gesture actions
  const checks: { cues: string[]; expectedGesture: GestureName | null; expectedGaze?: string }[] = [
    { cues: ["손총을 빵야 겨눈다"], expectedGesture: "shoot" },
    { cues: ["빙그르르 한 바퀴 회전한다"], expectedGesture: "spin" },
    { cues: ["공손히 허리 숙여 인사한다"], expectedGesture: "bow", expectedGaze: "down" },
    { cues: ["손을 번쩍 흔들며 인사한다"], expectedGesture: "wave" },
    { cues: ["손가락으로 브이 포즈를 취한다"], expectedGesture: "peace" },
    { cues: ["허리에 손을 올리고 당당하게 웃는다"], expectedGesture: "proud" },
    { cues: ["손으로 입을 가리고 풋 웃는다"], expectedGesture: "giggle", expectedGaze: "away" },
    { cues: ["만세를 부르며 환호한다"], expectedGesture: "cheer" },
    { cues: ["고개를 갸웃하며 궁금해한다"], expectedGesture: "curious" },
    { cues: ["턱에 손을 괴고 깊이 생각한다"], expectedGesture: "think", expectedGaze: "away" },
    { cues: ["신나게 콧노래를 흥얼거린다"], expectedGesture: "sing" },
    { cues: ["고개를 끄덕이며 동의한다"], expectedGesture: "nod" },
  ];

  for (const c of checks) {
    const req = ActionInterpreter.interpret(c.cues, "");
    assert.strictEqual(
      req.gesture,
      c.expectedGesture,
      `Expected gesture ${c.expectedGesture} for ${c.cues.join(" ")}, got ${req.gesture}`
    );
    if (c.expectedGaze) {
      assert.strictEqual(req.gaze, c.expectedGaze);
    }
  }

  console.log("   ✓ GestureMapping tests passed.");
}
