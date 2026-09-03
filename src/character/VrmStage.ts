import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { VRMAnimationLoaderPlugin, createVRMAnimationClip, VRMLookAtQuaternionProxy, type VRMAnimation } from "@pixiv/three-vrm-animation";
import { BlinkEngine } from "./BlinkEngine";
import { MotionDirector } from "./MotionDirector";
import { LookAtEyes } from "./LookAtEyes";
import { VisemeDriver } from "./VisemeDriver";
import { MOTION_CONFIG } from "./motionConfig";
import { clearMixamoClipCache } from "./loadMixamoAnimation";
import type { EmotionName, GestureName, ViewMode } from "../shared/types";

export class VrmStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  vrm: VRM | null = null;
  motion: MotionDirector | null = null;
  get gestures(): MotionDirector | null { return this.motion; }
  private look: LookAtEyes | null = null;
  private blink: BlinkEngine | null = null;
  private viseme: VisemeDriver | null = null;
  private clock = new THREE.Clock();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private running = true;
  private currentScale = 1.0;

  // Direct morph targets references on Body.baked(copy) mesh
  private skinnedMeshes: THREE.SkinnedMesh[] = [];

  // Morph indices:
  // [5] まばたき(Blink), [6] ワ(Mouth Smile), [7] はぅ(CHEEK CIRCLES - PERM 0), [8] ∧(Pout)
  // [9] 怒り(Angry), [10] 困る(Sad), [11] 涙(Tears), [12] 笑い(CLEAN SMILE EYES), [13] 下(LOOK DOWN - PERM 0)
  // [14] ウィンク２
  private currentEmotion: EmotionName = "neutral";
  private emotionWeights: Record<EmotionName, number> = {
    neutral: 1,
    happy: 0,
    relaxed: 0,
    angry: 0,
    sad: 0,
    surprised: 0,
  };

  // Diagnostic monitoring & metrics
  private vrmUpdateCounter = 0;
  private isLooping = false;
  private debugHudEl: HTMLElement | null = null;
  private hudFrameThrottle = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.1, 30);
    this.camera.position.set(0, 1.35, 2.1);

    const hemi = new THREE.HemisphereLight(0xffffff, 0xdde4ec, 1.15);
    const dir = new THREE.DirectionalLight(0xfffdfa, 1.25);
    dir.position.set(0.6, 1.8, 1.5);
    const fill = new THREE.DirectionalLight(0xfcfcff, 0.6);
    fill.position.set(-0.8, 1.2, 1.2);

    this.scene.add(hemi, dir, fill);
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.initDebugHUD();
  }

  resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async load(modelUrl: string, idleUrl?: string): Promise<void> {
    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
      clearMixamoClipCache();
      this.motion?.dispose();
      this.motion = null;
      this.look = null;
      this.blink = null;
      this.viseme = null;
      this.skinnedMeshes = [];
    }
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    const gltf = await loader.loadAsync(modelUrl);
    const vrm = gltf.userData.vrm as VRM;
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.rotateVRM0(vrm);

    this.skinnedMeshes = [];

    // Calibrate materials to completely eliminate eye clipping and z-fighting
    vrm.scene.traverse((obj) => {
      if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
        const mesh = obj as THREE.SkinnedMesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (mesh.morphTargetInfluences) {
          this.skinnedMeshes.push(mesh);
        }

        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((mat) => {
          const m = mat as THREE.Material;
          const name = (m.name || "").toLowerCase();

          if (name.includes("body")) {
            m.depthWrite = true;
            m.depthTest = true;
          } else if (name.includes("eye")) {
            m.polygonOffset = true;
            m.polygonOffsetFactor = -3.0;
            m.polygonOffsetUnits = -6.0;
            m.depthTest = true;
            m.depthWrite = true;
          } else if (name.includes("transparent")) {
            m.polygonOffset = true;
            m.polygonOffsetFactor = -4.0;
            m.polygonOffsetUnits = -8.0;
            m.depthTest = true;
            m.depthWrite = false;
          }
        });
      }
    });

    // Load idle VRMA mocap animation clip if provided
    let idleClip: THREE.AnimationClip | null = null;
    if (idleUrl) {
      try {
        const vrmaGltf = await loader.loadAsync(idleUrl);
        const vrmAnimations = (vrmaGltf.userData.vrmAnimations ?? [vrmaGltf.userData.vrmAnimation]) as VRMAnimation[];
        if (vrmAnimations && vrmAnimations[0]) {
          if (vrm.lookAt) {
            const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
            proxy.name = "VRMLookAtQuaternionProxy";
            vrm.scene.add(proxy);
          }
          idleClip = createVRMAnimationClip(vrmAnimations[0], vrm);
          console.log("[VRM] Loaded idle VRMA clip successfully! Duration:", idleClip.duration, "tracks:", idleClip.tracks.length);
        }
      } catch (err) {
        console.warn("[VRM] Failed to load idle VRMA clip, fallback to procedural:", err);
      }
    }

    this.scene.add(vrm.scene);
    this.vrm = vrm;
    this.motion = new MotionDirector(vrm, idleClip);
    if (MOTION_CONFIG.MOTION_V2) {
      await this.motion.loadGestureClips(loader);
    }
    this.look = new LookAtEyes(vrm, this.camera);
    this.blink = new BlinkEngine(vrm, () => this.look?.onBlink());
    this.viseme = new VisemeDriver(vrm);

    this.frameModel(vrm);
    this.startLoop();
  }

  setScale(scale: number): void {
    this.currentScale = THREE.MathUtils.clamp(scale, 0.5, 2.5);
    if (this.vrm) {
      this.vrm.scene.scale.setScalar(this.currentScale);
    }
  }

  private currentViewMode: ViewMode = "full";

  setViewMode(mode: ViewMode): void {
    this.currentViewMode = mode;
    if (this.vrm) {
      this.frameModel(this.vrm);
    }
  }

  private frameModel(vrm: VRM): void {
    vrm.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const fovRad = (this.camera.fov * Math.PI) / 180;

    if (this.currentViewMode === "upper") {
      // Upper Body Portrait (Focus on head, chest, and face)
      const lookY = 1.32;
      const dist = 1.75;
      this.camera.position.set(0, lookY, dist);
      this.camera.lookAt(0, lookY, 0);
    } else if (this.currentViewMode === "pip") {
      // PIP Mini Mode
      const lookY = 1.05;
      const dist = 2.4;
      this.camera.position.set(0, lookY, dist);
      this.camera.lookAt(0, lookY, 0);
    } else {
      // Full Body Mode (Fit head to toe)
      const margin = 1.18;
      const distH = (size.y * margin) / (2 * Math.tan(fovRad / 2));
      const distW = (size.x * margin) / (2 * Math.tan(fovRad / 2) * Math.max(0.5, this.camera.aspect));
      const dist = Math.max(distH, distW);
      const lookY = center.y * 0.95;
      this.camera.position.set(0, lookY, dist);
      this.camera.lookAt(0, lookY, 0);
    }
    this.camera.updateProjectionMatrix();
  }

  private startLoop(): void {
    if (this.isLooping) return;
    this.isLooping = true;
    this.loop();
  }

  private loop = (): void => {
    if (!this.running) {
      this.isLooping = false;
      return;
    }
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());

    try {
      if (MOTION_CONFIG.MOTION_V2) {
        // =========================================================================
        // CANONICAL V2 FRAME LOOP (Strict Contract)
        // 1) director.tick(dt) & 2) mixer.update(dt) & 3) procedural.apply(dt)
        // =========================================================================
        this.motion?.update(dt);

        // 4) lookAt.target 설정 (Gaze target position and saccades)
        this.look?.update(dt);

        // 5) expressionManager.setValue(...) (Emotions + Blink + Viseme LipSync)
        const isSmiling = this.emotionWeights.happy > 0.25 || this.emotionWeights.relaxed > 0.25;
        this.updateExpressionsV2(dt);
        this.blink?.update(dt, isSmiling);
        this.viseme?.update(dt);

        // 6) vrm.update(dt) — 유일한 호출 지점, 반드시 렌더 직전 마지막!
        if (this.vrm) {
          this.vrm.update(dt);
          this.vrmUpdateCounter++;
        }

        // 7) renderer.render(scene, camera)
        this.renderer.render(this.scene, this.camera);

        // Post-render diagnostic HUD update only
        // [RULE]: 이 뒤에 본/모프/표정 쓰기 절대 금지! (ZERO post-update writes)
        this.updateDebugHUD(dt);
      } else {
        // =========================================================================
        // LEGACY V1 FRAME LOOP (100% Rollback preservation)
        // =========================================================================
        this.motion?.update(dt);
        this.look?.captureHead();
        this.look?.update(dt);
        const isSmiling = this.emotionWeights.happy > 0.25 || this.emotionWeights.relaxed > 0.25;
        this.blink?.update(dt, isSmiling);
        this.viseme?.update(dt);
        this.vrm?.update(dt);
        this.look?.restoreHead();
        this.updateDirectMorphTargets(dt);
        this.renderer.render(this.scene, this.camera);
      }
    } catch (err) {
      console.error("[VrmStage Loop Error]:", err);
    }
  };

  /**
   * V2 Canonical Expression Driving:
   * Purely uses vrm.expressionManager.setValue(...).
   * Direct GPU morph target overrides are eliminated.
   */
  private updateExpressionsV2(dt: number): void {
    const em = this.vrm?.expressionManager;
    if (!em) return;

    // Smooth emotion transitions with 0.4s fade (1.0 / 0.4 = 2.5)
    const ems: EmotionName[] = ["neutral", "happy", "relaxed", "angry", "sad", "surprised"];
    for (const e of ems) {
      const target = this.currentEmotion === e ? 1.0 : 0.0;
      this.emotionWeights[e] = THREE.MathUtils.lerp(this.emotionWeights[e], target, Math.min(1, dt * 2.5));
    }

    // Strict 0.6 combined mouth weight limit:
    // When viseme is active (speaking), emotion mouth influence is scaled to 0.2
    // Viseme target is 0.4, ensuring emotion (0.2) + viseme (0.4) <= 0.60 maximum!
    const isSpeaking = this.viseme?.isActive ?? false;
    const maxEmotion = isSpeaking ? 0.2 : 0.6;
    em.setValue("happy", Math.min(maxEmotion, this.emotionWeights.happy * maxEmotion));
    em.setValue("relaxed", Math.min(maxEmotion, this.emotionWeights.relaxed * maxEmotion));
    em.setValue("angry", Math.min(maxEmotion, this.emotionWeights.angry * maxEmotion));
    em.setValue("sad", Math.min(maxEmotion, this.emotionWeights.sad * maxEmotion));
    if (em.expressionMap["surprised"]) {
      em.setValue("surprised", Math.min(maxEmotion, this.emotionWeights.surprised * maxEmotion));
    }
  }

  /**
   * Legacy V1 Direct GPU Morph Target Expression Driving
   * Skipped entirely when MOTION_CONFIG.MOTION_V2 is active.
   */
  private updateDirectMorphTargets(dt: number): void {
    if (MOTION_CONFIG.MOTION_V2) return; // Completely eliminated in V2
    if (this.skinnedMeshes.length === 0) return;

    // Smooth emotion transitions (Speed 5.0)
    const ems: EmotionName[] = ["neutral", "happy", "relaxed", "angry", "sad", "surprised"];
    for (const e of ems) {
      const target = this.currentEmotion === e ? 1.0 : 0.0;
      this.emotionWeights[e] = THREE.MathUtils.lerp(this.emotionWeights[e], target, Math.min(1, dt * 5.0));
    }

    const happyW = this.emotionWeights.happy;
    const relaxedW = this.emotionWeights.relaxed;
    const angryW = this.emotionWeights.angry;
    const sadW = this.emotionWeights.sad;
    const surprisedW = this.emotionWeights.surprised;

    // Direct GPU morph assignments on all primitives
    // [6] ワ, [7] はぅ, [8] ∧, [9] 怒り, [10] 困る, [11] 涙, [12] 笑い, [13] 下, [14] ウィンク２
    for (const mesh of this.skinnedMeshes) {
      const infl = mesh.morphTargetInfluences;
      if (!infl) continue;

      // Smiling Eyes [12] 笑い - Beautiful clean curve
      infl[12] = THREE.MathUtils.clamp(happyW * 0.85 + relaxedW * 0.65, 0, 1);

      // Mouth Smile [6] ワ
      infl[6] = THREE.MathUtils.clamp(happyW * 0.35 + surprisedW * 0.6, 0, 1);

      // Eyebrows Angry [9] 怒り
      infl[9] = THREE.MathUtils.clamp(angryW * 0.85, 0, 1);

      // Eyebrows Sad [10] 困る
      infl[10] = THREE.MathUtils.clamp(sadW * 0.85, 0, 1);

      // Pout Mouth [8] ∧
      infl[8] = THREE.MathUtils.clamp(angryW * 0.45, 0, 1);

      // CRITICAL: PERMANENT ZERO ON DEFECTIVE ARTIFACTS!
      infl[7] = 0.0;  // [7] はぅ (Cheek circle rings - ALWAYS ZERO!)
      infl[13] = 0.0; // [13] 下 (Eyeball down distortion - ALWAYS ZERO!)
      infl[11] = 0.0; // [11] 涙 (Giant tear mesh - ALWAYS ZERO!)
    }
  }

  private initDebugHUD(): void {
    if (typeof document === "undefined" || !MOTION_CONFIG.DEBUG_HUD_ENABLED) return;
    let el = document.getElementById("motion-debug-hud");
    if (!el) {
      el = document.createElement("div");
      el.id = "motion-debug-hud";
      el.style.position = "fixed";
      el.style.top = "12px";
      el.style.left = "12px";
      el.style.padding = "8px 12px";
      el.style.background = "rgba(15, 23, 42, 0.88)";
      el.style.border = "1px solid rgba(56, 189, 248, 0.4)";
      el.style.borderRadius = "6px";
      el.style.color = "#f8fafc";
      el.style.font = "11px/1.4 ui-monospace, monospace";
      el.style.zIndex = "9999";
      el.style.pointerEvents = "none";
      el.style.backdropFilter = "blur(6px)";
      el.style.boxShadow = "0 4px 12px rgba(0,0,0,0.4)";
      document.body.appendChild(el);
    }
    this.debugHudEl = el;
  }

  private updateDebugHUD(dt: number): void {
    if (!this.debugHudEl || !MOTION_CONFIG.DEBUG_HUD_ENABLED) return;
    this.hudFrameThrottle++;
    if (this.hudFrameThrottle % 4 !== 0) return; // Update every 4 frames

    const status = this.motion?.getDebugStatus();
    const em = this.vrm?.expressionManager;

    let topExpressions: string[] = [];
    if (em && em.expressionMap) {
      const activeList: { name: string; weight: number }[] = [];
      for (const name of Object.keys(em.expressionMap)) {
        const w = em.getValue(name) ?? 0;
        if (w > 0.001) {
          activeList.push({ name, weight: w });
        }
      }
      activeList.sort((a, b) => b.weight - a.weight);
      topExpressions = activeList.slice(0, 5).map((x) => `${x.name}: ${x.weight.toFixed(2)}`);
    }

    const convStateStr = status?.convState ?? (status?.isSpeaking ? "speaking" : "idle");
    const clipStr = status?.gesture ?? "none";
    const cdStr = status?.cooldown ?? "0.0s";
    const dtMs = (dt * 1000).toFixed(1);

    this.debugHudEl.innerHTML = `
      <div style="font-weight: bold; color: #38bdf8; margin-bottom: 2px;">MOTION V2 HUD (Active)</div>
      <div>ConvState: <span style="color:#4ade80; font-weight:bold;">${convStateStr}</span> | Gesture: <span>${clipStr}</span></div>
      <div>CD: <span>${cdStr}</span> | dt: <span>${dtMs}ms</span> | vrm.update: <span style="color:#facc15;">#${this.vrmUpdateCounter}</span></div>
      <div style="margin-top: 4px; font-size: 10px; color: #94a3b8;">Top Expressions:</div>
      <div style="font-size: 10px; color: #e2e8f0;">${topExpressions.length > 0 ? topExpressions.join(", ") : "none (weight 0)"}</div>
    `.trim();
  }

  hitTest(clientX: number, clientY: number): boolean {
    if (!this.vrm) return false;
    this.pointer.x = (clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.vrm.scene, true);
    return hits.length > 0;
  }

  play(name: GestureName): void {
    this.gestures?.play(name);
    if (name === "thinking") {
      this.look?.setThinking(true);
    } else if (name !== "idle") {
      this.look?.setThinking(false);
    }
  }

  setSpeaking(speaking: boolean): void {
    this.gestures?.setSpeaking(speaking);
    this.look?.setSpeaking(speaking);
    if (speaking) {
      this.look?.setThinking(false);
    }
  }

  setThinking(thinking: boolean): void {
    this.look?.setThinking(thinking);
  }

  setEmotion(name: EmotionName): void {
    this.currentEmotion = name;
  }

  speakVisemes(text: string, durationSec: number): void {
    this.viseme?.speak(text, durationSec);
  }

  stopVisemes(): void {
    this.viseme?.stop();
  }
}
