import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { VRMAnimationLoaderPlugin, createVRMAnimationClip, VRMLookAtQuaternionProxy, type VRMAnimation } from "@pixiv/three-vrm-animation";
import { BlinkEngine } from "./BlinkEngine";
import { MotionDirector } from "./MotionDirector";
import { LookAtEyes } from "./LookAtEyes";
import { VisemeDriver } from "./VisemeDriver";
import { LipSyncController } from "./LipSyncController";
import { MOTION_CONFIG } from "./motionConfig";
import { clearMixamoClipCache } from "./loadMixamoAnimation";
import type { EmotionName, GestureName, ViewMode } from "../shared/types";

export function resolveAssetUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("blob:") || url.startsWith("data:")) {
    return url;
  }
  if (/^[a-zA-Z]:[\\\/]/.test(url)) {
    return "file:///" + url.replace(/\\/g, "/");
  }
  if (window.location.protocol === "file:" && url.startsWith("/")) {
    return "." + url;
  }
  return url;
}

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
  private lipSync: LipSyncController | null = null;
  private clock = new THREE.Clock();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private running = true;
  private currentScale = 1.0;
  private dragPlane: THREE.Plane | null = null;
  private dragPlaneOffset = new THREE.Vector3();
  private dragIntersection = new THREE.Vector3();
  private dragInitialDepthZ = 0;
  private isDraggingModel = false;
  public currentVrmUrl: string = "./models/HatsuneMikuNT.vrm";
  public currentIdleUrl: string = "./models/idle_loop.vrma";

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
    this.currentVrmUrl = modelUrl;
    if (idleUrl) this.currentIdleUrl = idleUrl;
    const resolvedIdleUrl = idleUrl || this.currentIdleUrl;

    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
      clearMixamoClipCache();
      this.motion?.dispose();
      this.motion = null;
      this.look = null;
      this.blink = null;
      this.lipSync?.dispose();
      this.lipSync = null;
      this.viseme = null;
      this.skinnedMeshes = [];
    }
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    const gltf = await loader.loadAsync(resolveAssetUrl(modelUrl));
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
    if (resolvedIdleUrl) {
      try {
        const vrmaGltf = await loader.loadAsync(resolveAssetUrl(resolvedIdleUrl));
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

    // Sanitize expression bindings: fix models where 'happy' was bound to 'はぅ' (distorted comic eyes) instead of '笑い' (natural smile)
    if (vrm.expressionManager) {
      const happyExp = vrm.expressionManager.getExpression("happy");
      if (happyExp && (happyExp as any)._binds) {
        for (const b of (happyExp as any)._binds) {
          const mesh = b.primitives?.[0];
          const dict = mesh?.morphTargetDictionary;
          if (dict && dict["はぅ"] === b.index && dict["笑い"] !== undefined) {
            b.index = dict["笑い"];
          }
        }
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
    this.lipSync = new LipSyncController(vrm, this.viseme);

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

  async loadIdleMotion(vrmaUrl: string): Promise<void> {
    if (!this.vrm) return;
    this.currentIdleUrl = vrmaUrl;
    try {
      const loader = new GLTFLoader();
      loader.register((parser: any) => new VRMAnimationLoaderPlugin(parser));
      const vrmaGltf = await loader.loadAsync(resolveAssetUrl(vrmaUrl));
      const vrmAnimations = (vrmaGltf.userData.vrmAnimations ?? [vrmaGltf.userData.vrmAnimation]) as VRMAnimation[];
      if (vrmAnimations && vrmAnimations[0]) {
        if (this.vrm.lookAt && !this.vrm.scene.getObjectByName("VRMLookAtQuaternionProxy")) {
          const proxy = new VRMLookAtQuaternionProxy(this.vrm.lookAt);
          proxy.name = "VRMLookAtQuaternionProxy";
          this.vrm.scene.add(proxy);
        }
        const rawClip = createVRMAnimationClip(vrmAnimations[0], this.vrm);
        const cleanTracks = rawClip.tracks.filter((t) => !t.name.endsWith(".position"));
        const clip = new THREE.AnimationClip(rawClip.name, rawClip.duration, cleanTracks);
        this.motion?.setIdleClip(clip);
        console.log("[VRM] Updated idle motion live:", vrmaUrl, "duration:", clip.duration);
      }
    } catch (err) {
      console.warn("[VRM] Failed to update idle motion:", err);
      throw err;
    }
  }

  async previewVrmaMotion(vrmaUrl: string): Promise<void> {
    if (!this.vrm) return;
    try {
      const loader = new GLTFLoader();
      loader.register((parser: any) => new VRMAnimationLoaderPlugin(parser));
      const vrmaGltf = await loader.loadAsync(resolveAssetUrl(vrmaUrl));
      const vrmAnimations = (vrmaGltf.userData.vrmAnimations ?? [vrmaGltf.userData.vrmAnimation]) as VRMAnimation[];
      if (vrmAnimations && vrmAnimations[0]) {
        if (this.vrm.lookAt && !this.vrm.scene.getObjectByName("VRMLookAtQuaternionProxy")) {
          const proxy = new VRMLookAtQuaternionProxy(this.vrm.lookAt);
          proxy.name = "VRMLookAtQuaternionProxy";
          this.vrm.scene.add(proxy);
        }
        const rawClip = createVRMAnimationClip(vrmAnimations[0], this.vrm);
        const cleanTracks = rawClip.tracks.filter((t) => !t.name.endsWith(".position"));
        const clip = new THREE.AnimationClip(rawClip.name, rawClip.duration, cleanTracks);
        this.motion?.playCustomVrmaClip(clip);
        console.log("[VRM] Previewing VRMA motion live:", vrmaUrl, "duration:", clip.duration);
      }
    } catch (err) {
      console.warn("[VRM] Failed to preview VRMA motion:", err);
      throw err;
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
      // Full Body Mode (Fit head to toe + ample horizontal margin for dynamic twintail physics)
      const marginH = 1.18;
      const marginW = 1.42;
      const distH = (size.y * marginH) / (2 * Math.tan(fovRad / 2));
      const distW = (size.x * marginW) / (2 * Math.tan(fovRad / 2) * Math.max(0.5, this.camera.aspect));
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
        // 1) controller & director update
        this.motion?.update(dt);

        // 4) lookAt.target 설정 (Gaze target position and saccades)
        this.look?.update(dt);

        // 5) expressionManager.setValue(...) (Emotions + Blink + Viseme LipSync)
        const isSmiling = this.emotionWeights.happy > 0.25 || this.emotionWeights.relaxed > 0.25;
        this.updateExpressionsV2(dt);
        this.blink?.update(dt, isSmiling);
        this.lipSync?.update(dt);

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
        this.lipSync?.update(dt);
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

    // Smooth emotion transitions (~0.3s responsive natural fade)
    const ems: EmotionName[] = ["neutral", "happy", "relaxed", "angry", "sad", "surprised"];
    for (const e of ems) {
      const target = this.currentEmotion === e ? 1.0 : 0.0;
      this.emotionWeights[e] = THREE.MathUtils.lerp(this.emotionWeights[e], target, Math.min(1, dt * 8.0));
    }

    // Strict mouth and facial expression limit:
    // When lipSync or viseme is active (speaking), emotion mouth influence is scaled to 0.20
    // Viseme target is 0.40, ensuring emotion (0.20) + viseme (0.40) <= 0.60 maximum!
    const isSpeaking = this.lipSync?.isSpeaking ?? this.viseme?.isActive ?? false;
    const maxEmotion = isSpeaking ? 0.20 : 0.45;
    em.setValue("happy", this.emotionWeights.happy * maxEmotion);
    em.setValue("relaxed", this.emotionWeights.relaxed * maxEmotion);
    em.setValue("angry", this.emotionWeights.angry * maxEmotion);
    em.setValue("sad", this.emotionWeights.sad * maxEmotion);
    if (em.expressionMap["surprised"]) {
      em.setValue("surprised", this.emotionWeights.surprised * maxEmotion);
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
      el.title = "우클릭하여 상태창 닫기";
      el.style.position = "fixed";
      el.style.top = "8px";
      el.style.left = "50%";
      el.style.transform = "translateX(-50%)";
      el.style.padding = "4px 8px";
      el.style.background = "rgba(15, 23, 42, 0.45)"; // 반투명화
      el.style.border = "1px solid rgba(56, 189, 248, 0.25)";
      el.style.borderRadius = "5px";
      el.style.color = "#f8fafc";
      el.style.font = "8.5px/1.25 ui-monospace, monospace"; // 50% 컴팩트 크기
      el.style.zIndex = "9999";
      el.style.pointerEvents = "auto"; // 클릭/우클릭 허용
      el.style.cursor = "pointer";
      el.style.backdropFilter = "blur(8px)";
      el.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";
      el.style.userSelect = "none";
      el.style.transition = "opacity 0.2s ease";

      const hud = el;
      hud.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        hud.style.display = "none";
      });

      document.body.appendChild(hud);
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
      topExpressions = activeList.slice(0, 4).map((x) => `${x.name}:${x.weight.toFixed(2)}`);
    }

    const convStateStr = status?.convState ?? (status?.isSpeaking ? "speaking" : "idle");
    const clipStr = status?.gesture ?? "none";
    const cdStr = status?.cooldown ?? "0.0s";
    const dtMs = (dt * 1000).toFixed(1);

    this.debugHudEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 2px;">
        <span style="font-weight: bold; color: #38bdf8; font-size: 8px;">MOTION V2 HUD (Active)</span>
        <span style="font-size: 7px; color: #64748b;">(우클릭 닫기)</span>
      </div>
      <div><span style="color:#4ade80; font-weight:bold;">${convStateStr}</span> | <span style="color:#38bdf8;">${clipStr}</span> | CD:<span>${cdStr}</span> | <span>${dtMs}ms</span> | <span style="color:#facc15;">#${this.vrmUpdateCounter}</span></div>
      <div style="font-size: 7.5px; color: #94a3b8; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;">
        ${topExpressions.length > 0 ? topExpressions.join(", ") : "expr: none"}
      </div>
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

  startDragPlane(clientX: number, clientY: number): boolean {
    if (!this.vrm) return false;
    this.pointer.x = (clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.vrm.scene, true);
    if (hits.length === 0) return false;

    this.isDraggingModel = true;
    this.dragInitialDepthZ = this.vrm.scene.position.z;

    // Fixed plane perpendicular to camera direction, coplanar with character position
    const planeNormal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    this.dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, this.vrm.scene.position);

    if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragIntersection)) {
      this.dragPlaneOffset.subVectors(this.vrm.scene.position, this.dragIntersection);
    }
    return true;
  }

  updateDragPlane(clientX: number, clientY: number, applyScenePosition: boolean = false): void {
    if (!this.isDraggingModel || !this.vrm || !this.dragPlane) return;
    this.pointer.x = (clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragIntersection)) {
      if (applyScenePosition) {
        const target = this.dragIntersection.clone().add(this.dragPlaneOffset);
        this.vrm.scene.position.x = target.x;
        this.vrm.scene.position.y = target.y;
      }
      // Strict depth Z preservation invariant
      this.vrm.scene.position.z = this.dragInitialDepthZ;
    }
  }

  endDragPlane(): void {
    this.isDraggingModel = false;
    this.dragPlane = null;
  }

  getDragDiagnostics(): Record<string, any> {
    const vrmPos = this.vrm?.scene.position;
    const vrmScale = this.vrm?.scene.scale;
    const parent = this.vrm?.scene.parent;
    const camPos = this.camera.position;
    const camDist = this.vrm ? this.camera.position.distanceTo(this.vrm.scene.position) : 0;

    return {
      vrmPosition: vrmPos ? { x: Number(vrmPos.x.toFixed(4)), y: Number(vrmPos.y.toFixed(4)), z: Number(vrmPos.z.toFixed(4)) } : null,
      vrmScale: vrmScale ? { x: Number(vrmScale.x.toFixed(4)), y: Number(vrmScale.y.toFixed(4)), z: Number(vrmScale.z.toFixed(4)) } : null,
      parentPosition: parent ? { x: Number(parent.position.x.toFixed(4)), y: Number(parent.position.y.toFixed(4)), z: Number(parent.position.z.toFixed(4)) } : null,
      parentScale: parent ? { x: Number(parent.scale.x.toFixed(4)), y: Number(parent.scale.y.toFixed(4)), z: Number(parent.scale.z.toFixed(4)) } : null,
      cameraPosition: { x: Number(camPos.x.toFixed(4)), y: Number(camPos.y.toFixed(4)), z: Number(camPos.z.toFixed(4)) },
      cameraZoom: this.camera.zoom,
      cameraFov: this.camera.fov,
      cameraDistance: Number(camDist.toFixed(4)),
      orbitControlsTarget: null, // Isolated; not attached to character window
      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: Number(window.devicePixelRatio.toFixed(4)),
      },
    };
  }

  play(name: GestureName, timing?: { spanCompleteTime?: number; gestureEmitTime?: number; segmentId?: string; expiresAt?: number }): void {
    this.gestures?.play(name, timing);
    if (name === "thinking") {
      this.look?.setThinking(true);
    } else if (name !== "idle") {
      this.look?.setThinking(false);
    }
  }

  notifySegmentEnded(segmentId: string): void {
    this.gestures?.notifySegmentEnded(segmentId);
  }

  setSpeaking(speaking: boolean): void {
    this.gestures?.setSpeaking(speaking);
    this.look?.setSpeaking(speaking);
    if (speaking) {
      this.look?.setThinking(false);
    }
  }

  setThinking(thinking: boolean): void {
    this.gestures?.setConversationState(thinking ? "thinking" : "idle");
    this.look?.setThinking(thinking);
  }

  setEmotion(name: EmotionName): void {
    this.currentEmotion = name;
  }

  speakVisemes(text: string, durationSec: number): void {
    if (this.lipSync) {
      this.lipSync.speakText(text, durationSec);
    } else {
      this.viseme?.speak(text, durationSec);
    }
  }

  stopVisemes(): void {
    if (this.lipSync) {
      this.lipSync.stopText();
    } else {
      this.viseme?.stop();
    }
  }
}
