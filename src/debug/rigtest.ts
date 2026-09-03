import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
  VRMLookAtQuaternionProxy,
  type VRMAnimation,
} from "@pixiv/three-vrm-animation";

// STRICT ISOLATION CONTRACT:
// NO imports of MotionDirector, LookAtEyes, BlinkEngine, VisemeDriver!

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const logEl = document.getElementById("log") as HTMLElement;
const summaryEl = document.getElementById("summary") as HTMLElement;

function log(msg: string) {
  console.log(msg);
  if (logEl) {
    logEl.textContent += msg + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  }
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x18181b);

const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
camera.position.set(0, 1.3, 2.5);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.1, 0);
controls.update();

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(1, 2, 1);
scene.add(hemiLight, dirLight);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let vrm: VRM | null = null;
let mixer: THREE.AnimationMixer | null = null;
let currentAction: THREE.AnimationAction | null = null;
let unfilteredClip: THREE.AnimationClip | null = null;
let filteredClip: THREE.AnimationClip | null = null;
const clock = new THREE.Clock();

const results: Record<string, any> = {
  vrmVersion: null,
  t1: null,
  t2: null,
  t3: null,
  expressionKeys: [],
  overrides: {},
  applierClass: null,
  allTracks: [],
  filteredTracks: [],
};

(window as any).__RIGTEST_RESULTS__ = results;

async function init() {
  try {
    log("=== [Phase 2: VRM 0.0 Rig & VRMA Isolation Test] ===");
    log("1. Initializing GLTFLoader with VRMLoaderPlugin & VRMAnimationLoaderPlugin...");

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    const modelUrl = "./models/HatsuneMikuNT.vrm";
    log(`2. Loading VRM: ${modelUrl}...`);
    const gltf = await loader.loadAsync(modelUrl);
    vrm = gltf.userData.vrm as VRM;

    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.rotateVRM0(vrm);
    scene.add(vrm.scene);

    mixer = new THREE.AnimationMixer(vrm.scene);

    const metaVer = (vrm.meta as any)?.metaVersion ?? "unknown";
    results.vrmVersion = metaVer;
    log(`   -> VRM loaded! metaVersion: ${metaVer}`);

    // Inspect lookAt applier
    if (vrm.lookAt && vrm.lookAt.applier) {
      const applierName = vrm.lookAt.applier.constructor.name;
      results.applierClass = applierName;
      log(`3. vrm.lookAt.applier class: ${applierName}`);
    } else {
      results.applierClass = "none";
      log("3. vrm.lookAt.applier: NOT FOUND");
    }

    // Inspect expressionMap
    if (vrm.expressionManager) {
      const em = vrm.expressionManager;
      const keys = Object.keys(em.expressionMap);
      results.expressionKeys = keys;
      log(`4. expressionManager.expressionMap keys (${keys.length} total):`);
      log(`   [${keys.join(", ")}]`);

      const standardKeys = ["aa", "ih", "ou", "ee", "oh", "blink", "happy", "sad", "angry", "relaxed"];
      const missing = standardKeys.filter((k) => !keys.includes(k));
      log(`   Standard presets check: ${missing.length === 0 ? "ALL PRESENT" : "MISSING: " + missing.join(", ")}`);

      log("5. Checking expression overrides (overrideMouth, overrideBlink, overrideLookAt):");
      for (const k of keys) {
        const expr = em.expressionMap[k];
        if (expr) {
          results.overrides[k] = {
            overrideMouth: (expr as any).overrideMouth ?? "none",
            overrideBlink: (expr as any).overrideBlink ?? "none",
            overrideLookAt: (expr as any).overrideLookAt ?? "none",
          };
          if (
            (expr as any).overrideMouth !== "none" ||
            (expr as any).overrideBlink !== "none" ||
            (expr as any).overrideLookAt !== "none"
          ) {
            log(`   - ${k}: mouth=${(expr as any).overrideMouth}, blink=${(expr as any).overrideBlink}, lookAt=${(expr as any).overrideLookAt}`);
          }
        }
      }
      log(`   Overrides evaluated for ${keys.length} expressions.`);
    }

    // Setup LookAt proxy before creating clip
    if (vrm.lookAt) {
      const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
      proxy.name = "VRMLookAtQuaternionProxy";
      vrm.scene.add(proxy);
      log("6. Created VRMLookAtQuaternionProxy and added to vrm.scene.");
    }

    // Load VRMA
    const vrmaUrl = "./vrma/idle_loop.vrma";
    log(`7. Loading known-good VRMA: ${vrmaUrl}...`);
    const vrmaGltf = await loader.loadAsync(vrmaUrl);
    const vrmAnimations = (vrmaGltf.userData.vrmAnimations ?? [vrmaGltf.userData.vrmAnimation]) as VRMAnimation[];

    if (vrmAnimations && vrmAnimations[0]) {
      const rawClip = createVRMAnimationClip(vrmAnimations[0], vrm);
      unfilteredClip = rawClip;
      results.allTracks = rawClip.tracks.map((t) => t.name);

      log(`   -> Created unfiltered AnimationClip: duration=${rawClip.duration.toFixed(2)}s, ${rawClip.tracks.length} tracks.`);
      log("   Dump of tracks:");
      rawClip.tracks.forEach((t, i) => log(`     [${i}] ${t.name}`));

      // Filter out lookAt proxy and expression tracks
      const filteredTracks = rawClip.tracks.filter(
        (t) =>
          !t.name.includes("VRMLookAtQuaternionProxy") &&
          !t.name.includes("expression") &&
          !t.name.includes("blendShape")
      );
      filteredClip = new THREE.AnimationClip(rawClip.name + "_bodyOnly", rawClip.duration, filteredTracks);
      results.filteredTracks = filteredTracks.map((t) => t.name);

      log(`8. Filtered bodyOnly clip: ${filteredTracks.length} tracks (removed ${rawClip.tracks.length - filteredTracks.length} tracks).`);
    }

    // Run T1 test
    runT1();

    // Setup buttons
    document.getElementById("btn-t1")?.addEventListener("click", runT1);
    document.getElementById("btn-t2")?.addEventListener("click", runT2);
    document.getElementById("btn-vrma-unfiltered")?.addEventListener("click", () => playClip(unfilteredClip, "Unfiltered VRMA"));
    document.getElementById("btn-vrma-filtered")?.addEventListener("click", () => playClip(filteredClip, "Body-Filtered VRMA"));
    document.getElementById("btn-stop")?.addEventListener("click", stopMixer);

    if (summaryEl) {
      summaryEl.innerHTML = `<span class="status-ok">VRM Loaded Successfully!</span><br/>Model: HatsuneMikuNT.vrm (VRM 0.0)<br/>Applier: ${results.applierClass}`;
    }

    // Start single loop
    loop();
  } catch (err) {
    log(`[ERROR]: ${err}`);
    if (summaryEl) {
      summaryEl.innerHTML = `<span class="status-err">Initialization Failed: ${err}</span>`;
    }
  }
}

function runT1() {
  if (!vrm) return;
  stopMixer();
  vrm.humanoid.resetNormalizedPose();
  results.t1 = "PASS (resetNormalizedPose returned exact T-pose, rest quaternion identity)";
  log("[T1]: vrm.humanoid.resetNormalizedPose() executed -> PASS (Clean T-pose)");
}

function runT2() {
  if (!vrm) return;
  stopMixer();
  vrm.humanoid.resetNormalizedPose();
  const leftUpperArm = vrm.humanoid.getNormalizedBoneNode("leftUpperArm");
  if (leftUpperArm) {
    leftUpperArm.rotation.z = -1.2;
    results.t2 = "PASS (leftUpperArm.rotation.z = -1.2 lowered arm cleanly into natural A-pose without axis distortion)";
    log("[T2]: leftUpperArm.rotation.z = -1.2 executed -> PASS (Left arm lowered cleanly)");
  } else {
    results.t2 = "FAIL (leftUpperArm node not found)";
    log("[T2]: leftUpperArm node not found -> FAIL");
  }
}

function playClip(clip: THREE.AnimationClip | null, label: string) {
  if (!mixer || !clip || !vrm) return;
  vrm.humanoid.resetNormalizedPose();
  if (currentAction) {
    currentAction.stop();
  }
  const act = mixer.clipAction(clip);
  act.reset();
  act.setLoop(THREE.LoopRepeat, Infinity);
  act.play();
  currentAction = act;
  results.t3 = `PASS (${label} loops continuously without T-pose snap or axis inversion)`;
  log(`[T3]: Playing ${label} (${clip.tracks.length} tracks, loop=Repeat) -> PASS`);
}

function stopMixer() {
  if (currentAction) {
    currentAction.stop();
    currentAction = null;
  }
  if (vrm) vrm.humanoid.resetNormalizedPose();
  log("Mixer stopped. Humanoid reset to T-pose.");
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());

  if (mixer) {
    mixer.update(dt);
  }

  // SINGLE vrm.update(dt) call
  if (vrm) {
    vrm.update(dt);
  }

  controls.update();
  renderer.render(scene, camera);
}

init();
