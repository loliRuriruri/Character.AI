import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from "@pixiv/three-vrm-animation";
import { loadMixamoAnimation } from "../character/loadMixamoAnimation";

// STRICT ISOLATION CONTRACT:
// Absolutely NO imports or instances of:
// - MotionDirector
// - LookAtEyes
// - BlinkEngine
// - VisemeDriver

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const logEl = document.getElementById("log") as HTMLElement;

function log(msg: string) {
  console.log(msg);
  if (logEl) {
    logEl.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
}

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f172a);

// Grid and floor helper for reference
const gridHelper = new THREE.GridHelper(10, 20, 0x38bdf8, 0x1e293b);
gridHelper.position.y = 0;
scene.add(gridHelper);

const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
camera.position.set(0, 1.3, 3.2);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.0, 0);
controls.update();

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x334155, 1.2);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(1.5, 3, 2);
dirLight.castShadow = true;
scene.add(hemiLight, dirLight);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let vrm: VRM | null = null;
let mixer: THREE.AnimationMixer | null = null;
let currentAction: THREE.AnimationAction | null = null;
let activeClip: THREE.AnimationClip | null = null;
let isLooping = true;
let isPaused = false;
const clock = new THREE.Clock();

const clipsCache = new Map<string, THREE.AnimationClip>();
let initialHipsPos = new THREE.Vector3();

// HUD elements
const hudMotion = document.getElementById("hud-motion");
const hudMeta = document.getElementById("hud-meta");
const hudHips = document.getElementById("hud-hips");
const hudRHand = document.getElementById("hud-rhand");
const hudHeadYaw = document.getElementById("hud-headyaw");
const hudTPose = document.getElementById("hud-tpose");
const scrubber = document.getElementById("scrubber") as HTMLInputElement;
const timeVal = document.getElementById("time-val");

const motionsList: { id: string; name: string; type: "vrma" | "mixamo"; file: string }[] = [
  { id: "vrma-1", name: "VRMA_01 Show full body", type: "vrma", file: "./VRMA_MotionPack/vrma/VRMA_01.vrma" },
  { id: "vrma-2", name: "VRMA_02 Greeting", type: "vrma", file: "./VRMA_MotionPack/vrma/VRMA_02.vrma" },
  { id: "vrma-3", name: "VRMA_03 Peace sign", type: "vrma", file: "./VRMA_MotionPack/vrma/VRMA_03.vrma" },
  { id: "vrma-4", name: "VRMA_04 Shoot", type: "vrma", file: "./VRMA_MotionPack/vrma/VRMA_04.vrma" },
  { id: "vrma-5", name: "VRMA_05 Spin", type: "vrma", file: "./VRMA_MotionPack/vrma/VRMA_05.vrma" },
  { id: "vrma-6", name: "VRMA_06 Model pose", type: "vrma", file: "./VRMA_MotionPack/vrma/VRMA_06.vrma" },
  { id: "vrma-7", name: "VRMA_07 Squat", type: "vrma", file: "./VRMA_MotionPack/vrma/VRMA_07.vrma" },
  { id: "mix-wave", name: "Current: wave.fbx", type: "mixamo", file: "./vrma/mixamo/wave.fbx" },
  { id: "mix-nod", name: "Current: nod.fbx", type: "mixamo", file: "./vrma/mixamo/nod.fbx" },
  { id: "mix-explain", name: "Current: explain.fbx", type: "mixamo", file: "./vrma/mixamo/explain.fbx" },
  { id: "mix-laugh", name: "Current: laugh.fbx", type: "mixamo", file: "./vrma/mixamo/laugh.fbx" },
  { id: "mix-think", name: "Current: think.fbx", type: "mixamo", file: "./vrma/mixamo/think.fbx" },
];

async function loadMotionClip(item: (typeof motionsList)[0]): Promise<THREE.AnimationClip> {
  if (clipsCache.has(item.id)) {
    return clipsCache.get(item.id)!;
  }
  if (!vrm) throw new Error("VRM not loaded");

  log(`Loading ${item.name} (${item.file})...`);

  if (item.type === "vrma") {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    const gltf = await loader.loadAsync(item.file);
    const vrmAnimations = gltf.userData.vrmAnimations ?? [gltf.userData.vrmAnimation];
    if (!vrmAnimations || vrmAnimations.length === 0 || !vrmAnimations[0]) {
      throw new Error(`No VRMAnimation data found in ${item.file}`);
    }
    const clip = createVRMAnimationClip(vrmAnimations[0], vrm);
    clip.name = item.name;
    clipsCache.set(item.id, clip);
    log(`-> Loaded VRMA '${item.name}': duration ${clip.duration.toFixed(2)}s, ${clip.tracks.length} tracks`);
    return clip;
  } else {
    const clip = await loadMixamoAnimation(item.file, vrm, item.id);
    clip.name = item.name;
    clipsCache.set(item.id, clip);
    log(`-> Loaded Retargeted Mixamo '${item.name}': duration ${clip.duration.toFixed(2)}s, ${clip.tracks.length} tracks`);
    return clip;
  }
}

async function playMotion(id: string) {
  const item = motionsList.find((m) => m.id === id);
  if (!item || !mixer || !vrm) return;

  try {
    const clip = await loadMotionClip(item);
    if (currentAction) {
      currentAction.stop();
      mixer.uncacheAction(activeClip!);
    }

    // Reset humanoid pose before playing new action
    vrm.humanoid?.resetNormalizedPose();

    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(isLooping ? THREE.LoopRepeat : THREE.LoopOnce, isLooping ? Infinity : 1);
    action.clampWhenFinished = !isLooping;
    action.play();

    currentAction = action;
    activeClip = clip;
    isPaused = false;

    // Update button states
    document.querySelectorAll(".btn-grid button, .btn-grid-3 button").forEach((b) => {
      b.classList.remove("active");
    });
    const btn = document.getElementById(`btn-${id}`);
    if (btn) btn.classList.add("active");

    if (hudMotion) hudMotion.textContent = item.name;
    if (hudMeta) hudMeta.textContent = `${clip.duration.toFixed(2)}s / ${clip.tracks.length} tracks`;
    log(`▶ Playing: ${item.name}`);
  } catch (err: any) {
    log(`[ERROR] Failed to play ${id}: ${err.message}`);
  }
}

function stopMotion() {
  if (currentAction && mixer) {
    currentAction.stop();
    if (activeClip) mixer.uncacheAction(activeClip);
    currentAction = null;
    activeClip = null;
    vrm?.humanoid?.resetNormalizedPose();
    if (hudMotion) hudMotion.textContent = "Stopped (Reset Pose)";
    log("⏹ Stopped motion.");
  }
}

// Global Diagnostics API
(window as any).__MOTION_LAB__ = {
  getVRM: () => vrm,
  getMixer: () => mixer,
  getActiveClip: () => activeClip,
  playMotion,
  stopMotion,
  loadAllClips: async () => {
    for (const m of motionsList) {
      await loadMotionClip(m);
    }
  },
  samplePose: (timeSec: number) => {
    if (!mixer || !activeClip || !vrm) return null;
    mixer.setTime(timeSec);
    vrm.update(0.016);
    const rHand = vrm.humanoid?.getNormalizedBoneNode("rightHand");
    const head = vrm.humanoid?.getNormalizedBoneNode("head");
    const hips = vrm.humanoid?.getNormalizedBoneNode("hips");

    rHand?.updateWorldMatrix(true, false);
    head?.updateWorldMatrix(true, false);
    hips?.updateWorldMatrix(true, false);

    const radHead = Math.atan2(head?.matrixWorld.elements[8] || 0, head?.matrixWorld.elements[10] || 1);

    return {
      timeSec,
      hipsWorldPos: hips ? [hips.matrixWorld.elements[12], hips.matrixWorld.elements[13], hips.matrixWorld.elements[14]] : null,
      rHandWorldPos: rHand ? [rHand.matrixWorld.elements[12], rHand.matrixWorld.elements[13], rHand.matrixWorld.elements[14]] : null,
      rHandQuat: rHand ? [rHand.quaternion.x, rHand.quaternion.y, rHand.quaternion.z, rHand.quaternion.w] : null,
      headYawDeg: Number((radHead * 180 / Math.PI).toFixed(2)),
    };
  }
};

async function init() {
  try {
    log("=== [VRoid Hub Reference Motion Lab Initializing] ===");
    log("1. Setting up GLTFLoader with VRMLoaderPlugin & VRMAnimationLoaderPlugin...");

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    const modelUrl = "./models/HatsuneMikuNT.vrm";
    log(`2. Loading target VRM model: ${modelUrl}...`);
    const gltf = await loader.loadAsync(modelUrl);
    vrm = gltf.userData.vrm as VRM;

    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.rotateVRM0(vrm);
    scene.add(vrm.scene);

    const hipsNode = vrm.humanoid?.getNormalizedBoneNode("hips");
    if (hipsNode) {
      hipsNode.getWorldPosition(initialHipsPos);
    }

    mixer = new THREE.AnimationMixer(vrm.scene);

    const meta = vrm.meta as any;
    log(`-> VRM loaded successfully! Title: ${meta?.title || "Hatsune Miku"}, Version: ${meta?.metaVersion}`);
    log("-> 100% Isolation: All procedural bone animation scripts are strictly unreferenced.");

    // Bind UI buttons
    document.getElementById("btn-vrma-1")?.addEventListener("click", () => playMotion("vrma-1"));
    document.getElementById("btn-vrma-2")?.addEventListener("click", () => playMotion("vrma-2"));
    document.getElementById("btn-vrma-3")?.addEventListener("click", () => playMotion("vrma-3"));
    document.getElementById("btn-vrma-4")?.addEventListener("click", () => playMotion("vrma-4"));
    document.getElementById("btn-vrma-5")?.addEventListener("click", () => playMotion("vrma-5"));
    document.getElementById("btn-vrma-6")?.addEventListener("click", () => playMotion("vrma-6"));
    document.getElementById("btn-vrma-7")?.addEventListener("click", () => playMotion("vrma-7"));

    document.getElementById("btn-mix-wave")?.addEventListener("click", () => playMotion("mix-wave"));
    document.getElementById("btn-mix-nod")?.addEventListener("click", () => playMotion("mix-nod"));
    document.getElementById("btn-mix-explain")?.addEventListener("click", () => playMotion("mix-explain"));
    document.getElementById("btn-mix-laugh")?.addEventListener("click", () => playMotion("mix-laugh"));
    document.getElementById("btn-mix-think")?.addEventListener("click", () => playMotion("mix-think"));

    // Comparison modes
    let greetingToggle = false;
    document.getElementById("btn-cmp-greeting")?.addEventListener("click", () => {
      greetingToggle = !greetingToggle;
      if (greetingToggle) {
        log("🔍 [A/B Compare] Playing Official VRoid Greeting (VRMA_02)...");
        playMotion("vrma-2");
      } else {
        log("🔍 [A/B Compare] Playing Current Greeting (Mixamo wave.fbx)...");
        playMotion("mix-wave");
      }
    });

    let poseToggle = false;
    document.getElementById("btn-cmp-pose")?.addEventListener("click", () => {
      poseToggle = !poseToggle;
      if (poseToggle) {
        log("🔍 [A/B Compare] Playing Official VRoid Pose (VRMA_01 Show full body)...");
        playMotion("vrma-1");
      } else {
        log("🔍 [A/B Compare] Playing Current AI Gesture (Mixamo explain.fbx)...");
        playMotion("mix-explain");
      }
    });

    // Control buttons
    document.getElementById("btn-play")?.addEventListener("click", () => {
      if (!currentAction) return;
      isPaused = !isPaused;
      currentAction.paused = isPaused;
      log(isPaused ? "⏸ Paused" : "▶ Resumed");
    });

    document.getElementById("btn-stop")?.addEventListener("click", () => stopMotion());

    const btnLoop = document.getElementById("btn-loop");
    btnLoop?.addEventListener("click", () => {
      isLooping = !isLooping;
      if (btnLoop) btnLoop.textContent = `Loop: ${isLooping ? "ON" : "OFF"}`;
      if (currentAction) {
        currentAction.setLoop(isLooping ? THREE.LoopRepeat : THREE.LoopOnce, isLooping ? Infinity : 1);
        currentAction.clampWhenFinished = !isLooping;
      }
    });

    scrubber?.addEventListener("input", (e) => {
      if (!currentAction || !activeClip) return;
      const pct = Number((e.target as HTMLInputElement).value) / 100;
      const targetTime = pct * activeClip.duration;
      currentAction.time = targetTime;
      mixer?.setTime(targetTime);
    });

    // Auto-play default official greeting VRMA_02 to show reference motion immediately
    await playMotion("vrma-2");

    startLoop();
  } catch (err: any) {
    log(`[FATAL INIT ERROR] ${err.message}`);
  }
}

function startLoop() {
  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (mixer && currentAction && !isPaused) {
      mixer.update(delta);
    }

    if (vrm) {
      vrm.update(delta);
      updateHUD();
    }

    controls.update();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);
}

function updateHUD() {
  if (!vrm) return;

  const hips = vrm.humanoid?.getNormalizedBoneNode("hips");
  const rHand = vrm.humanoid?.getNormalizedBoneNode("rightHand");
  const head = vrm.humanoid?.getNormalizedBoneNode("head");

  if (hips && hudHips) {
    const p = new THREE.Vector3();
    hips.getWorldPosition(p);
    const dx = (p.x - initialHipsPos.x) * 100;
    const dy = (p.y - initialHipsPos.y) * 100;
    const dz = (p.z - initialHipsPos.z) * 100;
    hudHips.textContent = `ΔX:${dx.toFixed(1)} ΔY:${dy.toFixed(1)} ΔZ:${dz.toFixed(1)} cm`;
  }

  if (rHand && hudRHand) {
    const p = new THREE.Vector3();
    rHand.getWorldPosition(p);
    hudRHand.textContent = `[${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}]`;

    // T-pose detection: when arm is horizontal (y around shoulder height ~1.15m and x > 0.45m while rot near 0)
    const isTPose = Math.abs(rHand.quaternion.x) < 0.02 && Math.abs(rHand.quaternion.y) < 0.02 && Math.abs(rHand.quaternion.z) < 0.02;
    if (hudTPose) {
      if (isTPose) {
        hudTPose.textContent = "ALERT: Near T-Pose!";
        hudTPose.className = "hud-val err";
      } else {
        hudTPose.textContent = "Normal Humanoid Motion";
        hudTPose.className = "hud-val ok";
      }
    }
  }

  if (head && hudHeadYaw) {
    const rad = Math.atan2(head.matrixWorld.elements[8], head.matrixWorld.elements[10]);
    hudHeadYaw.textContent = `${(rad * 180 / Math.PI).toFixed(1)}°`;
  }

  if (currentAction && activeClip && scrubber && timeVal) {
    const curTime = currentAction.time % activeClip.duration;
    scrubber.value = String((curTime / activeClip.duration) * 100);
    timeVal.textContent = `${curTime.toFixed(1)}s / ${activeClip.duration.toFixed(1)}s`;
  }
}

init();
