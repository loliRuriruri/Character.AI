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

lipSyncBus.clear();
const mock = createMockVRM();
const viseme = new VisemeDriver(mock.vrm);
const controller = new LipSyncController(mock.vrm, viseme);

// 20-frame natural speech envelope simulation
const rawRmsPattern = [
  0.002, // 1: Silence
  0.005, // 2: Near silence
  0.012, // 3: Voice onset
  0.038, // 4: Vowel attack
  0.065, // 5: Rising
  0.088, // 6: Crest
  0.098, // 7: Peak
  0.084, // 8: Decay
  0.052, // 9: Consonant transition
  0.032, // 10: Inter-syllable dip
  0.024, // 11: Brief pause
  0.055, // 12: Second vowel attack
  0.078, // 13: Strong rise
  0.092, // 14: Second peak
  0.081, // 15: Sustained
  0.058, // 16: Fade
  0.035, // 17: Consonant release
  0.014, // 18: Trail
  0.005, // 19: Offset
  0.001, // 20: Silence
];

lipSyncBus.emit({ type: "rms:start" });

console.log("| Frame | Time(ms) | Raw RMS | Smoothed RMS | MouthOpen (0..1) | VRM 'aa' Value | Mode | DoubleWrites |");
console.log("| :---: | :------: | :-----: | :----------: | :--------------: | :------------: | :--: | :----------: |");

let prevSmoothedRms = 0;
const dt = 0.033; // ~30fps frame time

for (let i = 0; i < rawRmsPattern.length; i++) {
  const frameNum = i + 1;
  const timeMs = Math.round(i * 33.3);
  const rawRms = rawRmsPattern[i];
  const smoothedRms = computeSmoothedRms(prevSmoothedRms, rawRms);
  prevSmoothedRms = smoothedRms;

  const mouthOpen = computeMouthOpen(smoothedRms);

  lipSyncBus.emit({
    type: "rms:frame",
    payload: {
      mouthOpen,
      rawRms,
      smoothedRms,
      speaking: frameNum < 20,
    },
  });

  mock.advanceFrame();
  controller.update(dt);

  const aaVal = mock.vrm.expressionManager!.getValue("aa");
  const tel = controller.getTelemetry();

  console.log(
    `| ${frameNum.toString().padStart(5)} | ${timeMs.toString().padStart(8)} | ${rawRms.toFixed(3).padStart(7)} | ${smoothedRms.toFixed(3).padStart(12)} | ${mouthOpen.toFixed(3).padStart(16)} | ${aaVal.toFixed(3).padStart(14)} | ${tel.mode.padEnd(4)} | ${tel.doubleWritesTotal.toString().padStart(12)} |`
  );
}

lipSyncBus.emit({ type: "rms:stop" });
mock.advanceFrame();
controller.update(dt);
controller.dispose();
