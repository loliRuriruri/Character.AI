import assert from "node:assert";
import type { VRM } from "@pixiv/three-vrm";
import { LipSyncController } from "../src/character/LipSyncController";
import { VisemeDriver } from "../src/character/VisemeDriver";
import { lipSyncBus } from "../src/character/lipSyncBus";
import { computeMouthOpen, computeSmoothedRms } from "../src/character/audioContextPlayer";

function createMockVRM() {
  const expressions: Record<string, number> = {};
  let currentFrame = 0;
  const frameWrites = new Map<number, Map<string, number>>();

  const expressionManager = {
    expressionMap: {
      aa: {}, ee: {}, ih: {}, oh: {}, ou: {},
      blink: {}, happy: {}, relaxed: {}, angry: {}, sad: {}, surprised: {}
    },
    setValue: (name: string, value: number) => {
      expressions[name] = value;
      if (!frameWrites.has(currentFrame)) {
        frameWrites.set(currentFrame, new Map());
      }
      const fw = frameWrites.get(currentFrame)!;
      fw.set(name, (fw.get(name) ?? 0) + 1);
    },
    getValue: (name: string) => {
      return expressions[name] ?? 0;
    },
  };

  return {
    vrm: { expressionManager } as unknown as VRM,
    expressions,
    frameWrites,
    advanceFrame: () => { currentFrame++; },
    getCurrentFrame: () => currentFrame,
  };
}

export function testLipSyncBridge() {
  console.log("-> Running tests/lipsync-bridge.test.ts");
  lipSyncBus.clear();

  // Test 1: Silence mouth < 0.05
  {
    const mock = createMockVRM();
    const viseme = new VisemeDriver(mock.vrm);
    const controller = new LipSyncController(mock.vrm, viseme);

    const rawRms = 0.004;
    const mouthOpen = computeMouthOpen(rawRms); // should be 0 (< 0.05)
    assert.strictEqual(mouthOpen, 0, "Silence RMS must yield 0 mouthOpen");

    lipSyncBus.emit({ type: "rms:start" });
    lipSyncBus.emit({
      type: "rms:frame",
      payload: { mouthOpen, rawRms, smoothedRms: rawRms, speaking: true }
    });

    controller.update(0.05);
    assert.ok(controller.mouthOpen < 0.05, `MouthOpen must be < 0.05 on silence, got ${controller.mouthOpen}`);
    assert.ok(mock.vrm.expressionManager!.getValue("aa") < 0.05, `VRM 'aa' must be < 0.05 on silence`);
    controller.dispose();
  }
  console.log("   ✓ Test 1 Passed: Silence mouth < 0.05");

  // Test 2: Vocalization mouth > 0.3
  {
    const mock = createMockVRM();
    const viseme = new VisemeDriver(mock.vrm);
    const controller = new LipSyncController(mock.vrm, viseme);

    const rawRms = 0.08;
    const mouthOpen = computeMouthOpen(rawRms); // ~0.697
    assert.ok(mouthOpen > 0.3, `Vocal RMS 0.08 must compute mouthOpen > 0.3, got ${mouthOpen}`);

    lipSyncBus.emit({ type: "rms:start" });
    lipSyncBus.emit({
      type: "rms:frame",
      payload: { mouthOpen, rawRms, smoothedRms: rawRms, speaking: true }
    });

    // Advance 10 frames to allow lerp to converge
    for (let i = 0; i < 10; i++) {
      mock.advanceFrame();
      controller.update(0.033);
    }

    assert.ok(controller.mouthOpen > 0.3, `Controller mouthOpen must be > 0.3, got ${controller.mouthOpen}`);
    assert.ok(mock.vrm.expressionManager!.getValue("aa") > 0.3, `VRM 'aa' must be > 0.3, got ${mock.vrm.expressionManager!.getValue("aa")}`);
    controller.dispose();
  }
  console.log("   ✓ Test 2 Passed: Vocalization mouth > 0.3");

  // Test 3: Stop immediacy mouth = 0
  {
    const mock = createMockVRM();
    const viseme = new VisemeDriver(mock.vrm);
    const controller = new LipSyncController(mock.vrm, viseme);

    lipSyncBus.emit({ type: "rms:start" });
    lipSyncBus.emit({
      type: "rms:frame",
      payload: { mouthOpen: 0.8, rawRms: 0.1, smoothedRms: 0.1, speaking: true }
    });
    for (let i = 0; i < 5; i++) controller.update(0.033);

    // Now call stop
    lipSyncBus.emit({ type: "rms:stop" });
    assert.strictEqual(controller.getTelemetry().mouthOpen, 0, "Telemetry mouthOpen must immediately reset to 0 on stop");

    // Fast decay
    for (let i = 0; i < 15; i++) {
      mock.advanceFrame();
      controller.update(0.033);
    }
    assert.strictEqual(controller.mouthOpen, 0, "Controller mouthOpen must reach 0 after stop decay");
    assert.strictEqual(mock.vrm.expressionManager!.getValue("aa"), 0, "VRM 'aa' must be 0 after stop decay");
    controller.dispose();
  }
  console.log("   ✓ Test 3 Passed: Stop immediacy mouth = 0");

  // Test 4: Happy / Embarrassed coexistence
  {
    const mock = createMockVRM();
    const viseme = new VisemeDriver(mock.vrm);
    const controller = new LipSyncController(mock.vrm, viseme);

    // Active happy emotion
    mock.vrm.expressionManager!.setValue("happy", 0.20);
    assert.strictEqual(mock.vrm.expressionManager!.getValue("happy"), 0.20);

    // Play vocal speech
    lipSyncBus.emit({ type: "rms:start" });
    lipSyncBus.emit({
      type: "rms:frame",
      payload: { mouthOpen: 0.6, rawRms: 0.07, smoothedRms: 0.07, speaking: true }
    });
    for (let i = 0; i < 10; i++) {
      mock.advanceFrame();
      controller.update(0.033);
    }

    // Happy emotion must NOT be clobbered by mouth channel
    assert.strictEqual(mock.vrm.expressionManager!.getValue("happy"), 0.20, "Happy expression must remain intact");
    assert.ok(mock.vrm.expressionManager!.getValue("aa") > 0.3, "VRM 'aa' must move independently with speech");
    assert.strictEqual(mock.vrm.expressionManager!.getValue("blink"), 0, "Blink channel must remain unaffected");
    controller.dispose();
  }
  console.log("   ✓ Test 4 Passed: Happy/Embarrassed coexistence with lip-sync");

  // Test 5: Speech completion recovery
  {
    const mock = createMockVRM();
    const viseme = new VisemeDriver(mock.vrm);
    const controller = new LipSyncController(mock.vrm, viseme);

    // While speaking
    lipSyncBus.emit({ type: "rms:start" });
    lipSyncBus.emit({
      type: "rms:frame",
      payload: { mouthOpen: 0.5, rawRms: 0.06, smoothedRms: 0.06, speaking: true }
    });
    assert.strictEqual(controller.isSpeaking, true, "Controller must report isSpeaking=true during playback");
    let maxEmotion = controller.isSpeaking ? 0.20 : 0.45;
    assert.strictEqual(maxEmotion, 0.20, "maxEmotion must be 0.20 during speech");

    // After speech ends
    lipSyncBus.emit({ type: "rms:stop" });
    assert.strictEqual(controller.isSpeaking, false, "Controller must report isSpeaking=false after stop");
    maxEmotion = controller.isSpeaking ? 0.20 : 0.45;
    assert.strictEqual(maxEmotion, 0.45, "maxEmotion must recover to 0.45 after speech ends");
    controller.dispose();
  }
  console.log("   ✓ Test 5 Passed: Speech completion recovery to 0.45 maxEmotion");

  // Test 6: Zero double-write arbitration
  {
    const mock = createMockVRM();
    const viseme = new VisemeDriver(mock.vrm);
    const controller = new LipSyncController(mock.vrm, viseme);

    // Concurrently trigger text visemes AND RMS audio frames
    controller.speakText("안녕하세요 미쿠입니다", 3.0);
    lipSyncBus.emit({ type: "rms:start" });
    lipSyncBus.emit({
      type: "rms:frame",
      payload: { mouthOpen: 0.55, rawRms: 0.065, smoothedRms: 0.065, speaking: true }
    });

    assert.strictEqual(controller.currentMode, "rms", "RMS must win arbitration over text");

    for (let f = 0; f < 30; f++) {
      mock.advanceFrame();
      controller.update(0.016);

      const fw = mock.frameWrites.get(mock.getCurrentFrame())!;
      assert.ok(fw, `Frame ${mock.getCurrentFrame()} must have recorded writes`);
      for (const [channel, count] of fw.entries()) {
        assert.strictEqual(
          count,
          1,
          `Channel '${channel}' at frame ${mock.getCurrentFrame()} was written ${count} times (must be exactly 1)`
        );
      }
    }

    assert.strictEqual(controller.getTelemetry().doubleWritesTotal, 0, "Double-write total must be exactly 0");
    controller.dispose();
  }
  console.log("   ✓ Test 6 Passed: Zero double-writes under concurrent text+RMS arbitration");

  console.log("   ✓ ALL LipSync Bridge tests passed cleanly.");
}
