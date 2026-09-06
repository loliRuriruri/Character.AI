import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { GestureName } from "../shared/types";
import { MOTION_CONFIG } from "./motionConfig";
import { motionEventBus, type MotionEvent, type MotionIntentData } from "./motionEventBus";
import { loadMixamoAnimation } from "./loadMixamoAnimation";
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from "@pixiv/three-vrm-animation";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type ConvState = "idle" | "listening" | "thinking" | "speaking" | "afterglow";

const GESTURE_MAX_DURATION = 5.0; // Conversational gesture length limit (VRMA native)
const GESTURE_START_OFFSETS: Record<string, number> = {
  nod: 0.15,     // 0.15s dead pause skip -> immediate 1x nod
  wave: 1.10,    // 1.10s rest pause skip -> immediate right hand wave elevation
  bow: 0.0,      // Standing bow
  explain: 0.0,  // Native VRMA Show full body
  laugh: 0.0,    // Native VRMA Peace sign
  think: 0.30,   // Hand to chin rise
  peace: 0.0,    // Native VRMA Peace sign
  proud: 0.0,    // Native VRMA Model pose
  cheer: 0.0,    // Native VRMA Show full body
  shoot: 0.0,    // Native VRMA Shoot (빵야)
  spin: 0.0,     // Native VRMA Spin (360도 회전)
};

const _scratchEuler = new THREE.Euler();
const _scratchQuat = new THREE.Quaternion();

export interface GestureTimingPayload {
  spanCompleteTime?: number;
  gestureEmitTime?: number;
  segmentId?: string;
  expiresAt?: number;
}

export class MotionLatencyTracker {
  private static samples: number[] = [];

  static record(metric: { spanToEmitMs: number; emitToStartMs: number; totalSpanToMotionMs: number; gesture: string }): void {
    this.samples.push(metric.totalSpanToMotionMs);
    if (this.samples.length > 100) this.samples.shift();

    const sorted = [...this.samples].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];

    console.log(
      `[MotionLatency] '${metric.gesture}' started | span->emit: ${metric.spanToEmitMs.toFixed(1)}ms, emit->play: ${metric.emitToStartMs.toFixed(1)}ms, total: ${metric.totalSpanToMotionMs.toFixed(1)}ms | P50: ${p50.toFixed(1)}ms, P95: ${p95.toFixed(1)}ms (N=${this.samples.length})`
    );
  }
}

/**
 * MotionDirector — Warudo & ChatVRM style 4-Layer Motion Controller
 * 
 * Layer 1: Base Idle (Continuous full-body mocap VRMA loop)
 * Layer 2: Gesture Overlay (Cross-faded transient/reaction clips with full-body kinetic chain)
 * Layer 3: Gaze & LookAt Distribution (Eyes 65% + Head 25% + Chest 10%)
 * Layer 4: Procedural Dynamics (Multi-frequency breathing, 30-joint cascading fingers, fluid wrist slerp)
 */
export class MotionDirector {
  private vrm: VRM;
  readonly mixer: THREE.AnimationMixer;
  private restQuats: Map<string, THREE.Quaternion> = new Map();
  private fallbackTimer: any = null;
  private frameCounter: number = 0;

  // Layer 1: Base Idle Action
  private idleAction: THREE.AnimationAction | null = null;

  // Layer 2: Gesture Actions & Clips
  private currentAction: THREE.AnimationAction | null = null;
  private currentGesture: GestureName = "idle";
  private gestureTime = 0;
  private gestureDuration = 2.4;
  private isCrossFadingOut = false;

  private gestureClips: Map<GestureName, THREE.AnimationClip> = new Map();
  private gestureActions: Map<GestureName, THREE.AnimationAction> = new Map();

  // 5-Stage Conversation State Machine
  private convState: ConvState = "idle";
  private stateTimer = 0;
  private transitionMotionType: ConvState | null = null;
  private transitionMotionProgress = 1.0; // 0 to 1, 1 means finished
  private transitionMotionDuration = 0.45; // 0.3 ~ 0.6s
  private unsubscribeBus: (() => void) | null = null;

  // Speech body language cycling (Calm, natural conversational gestures only)
  private isSpeaking = false;
  private speechTimer = 0;
  private speechIndex = 0;
  private readonly speechGestures: GestureName[] = ["talk", "nod", "curious"];

  // Gesture repetition prevention & Cooldown system
  private recentHistory: GestureName[] = [];
  private gestureCooldowns: Map<GestureName, number> = new Map();
  private globalCooldown = 0;

  // Bounded gesture queue/scheduler for chaining valid gestures
  private gestureQueue: Array<{
    name: GestureName;
    queuedAt: number;
    timing?: GestureTimingPayload;
    segmentId?: string;
    expiresAt?: number;
  }> = [];
  private completedSegmentIds: Set<string> = new Set();
  private readonly MAX_QUEUE_SIZE = 3;
  private readonly QUEUE_ITEM_TTL_MS = 6000;

  // Diagnostics & Debug Controls (Work Order Section 4, 16)
  public proceduralEnabled = true;
  public knownGoodVrmaOnly = false;

  // Humanoid bone cache
  private bones: Record<string, THREE.Object3D | null> = {};

  // Procedural timers & targets
  private totalTime = 0;
  private leftWristTarget = new THREE.Quaternion();
  private rightWristTarget = new THREE.Quaternion();

  private static readonly REST_FINGER_QUATS: Record<string, number[]> = {
    "Normalized_Thumb_ProximalR": [0.0119, -0.0085, 0.0382, 0.9992],
    "Normalized_Thumb_IntermediateR": [-0.1379, -0.2302, 0.1611, 0.9497],
    "Normalized_Thumb_DistalR": [0.1327, -0.0385, 0.1056, 0.9848],
    "Normalized_Index_ProximalR": [-0.001, 0.0108, -0.0595, 0.9982],
    "Normalized_Index_IntermediateR": [0, 0.0121, 0.1513, -0.9884],
    "Normalized_Index_DistalR": [0, -0.0058, -0.0702, 0.9975],
    "Normalized_Middle_ProximalR": [0.0036, -0.0194, -0.1305, 0.9912],
    "Normalized_Middle_IntermediateR": [0, 0.0115, 0.1515, -0.9884],
    "Normalized_Middle_DistalR": [0.0001, -0.0134, -0.1602, 0.987],
    "Normalized_Ring_ProximalR": [-0.0045, 0.0263, 0.1775, -0.9838],
    "Normalized_Ring_IntermediateR": [0, 0.015, 0.1817, -0.9832],
    "Normalized_Ring_DistalR": [0, -0.0128, -0.1555, 0.9878],
    "Normalized_Little_ProximalR": [0.0035, -0.0425, -0.2285, 0.9726],
    "Normalized_Little_IntermediateR": [0.0003, -0.0115, -0.1515, 0.9884],
    "Normalized_Little_DistalR": [0.0003, -0.0122, -0.1438, 0.9895],
    "Normalized_Thumb_ProximalL": [0.0029, 0.0246, -0.0434, 0.9988],
    "Normalized_Thumb_IntermediateL": [-0.1285, 0.1943, -0.1647, 0.9584],
    "Normalized_Thumb_DistalL": [0.1192, 0.0339, -0.0744, 0.9895],
    "Normalized_Index_ProximalL": [0.0007, 0.0085, -0.0662, -0.9978],
    "Normalized_Index_IntermediateL": [0, -0.0156, -0.151, -0.9884],
    "Normalized_Index_DistalL": [0, -0.0071, -0.0701, -0.9975],
    "Normalized_Middle_ProximalL": [-0.0038, -0.0229, -0.1365, -0.9904],
    "Normalized_Middle_IntermediateL": [0, 0.0155, 0.1513, 0.9884],
    "Normalized_Middle_DistalL": [0, -0.0164, -0.1599, -0.987],
    "Normalized_Ring_ProximalL": [0.0047, 0.0315, 0.1833, 0.9826],
    "Normalized_Ring_IntermediateL": [0, 0.0186, 0.1814, 0.9832],
    "Normalized_Ring_DistalL": [0, 0.0159, 0.1552, 0.9877],
    "Normalized_Little_ProximalL": [0.0031, 0.051, 0.2339, 0.9709],
    "Normalized_Little_IntermediateL": [-0.0006, 0.0153, 0.1513, 0.9884],
    "Normalized_Little_DistalL": [-0.0005, 0.0146, 0.1435, 0.9895],
    "Normalized_Head": [0, 0, 0, 1]
  };

  private padIdleClip(idleClip: THREE.AnimationClip): THREE.AnimationClip {
    // Eliminate root motion displacement (e.g. mocap stage 16.6cm offset in Hips.position)
    const cleanTracks = idleClip.tracks.filter((t) => !t.name.includes("Hips.position"));
    const existingTrackNames = new Set(cleanTracks.map((t) => t.name));
    const newTracks = [...cleanTracks];
    const duration = idleClip.duration || 10.0;
    const times = [0, duration];

    for (const [nodeName, q] of Object.entries(MotionDirector.REST_FINGER_QUATS)) {
      const trackName = `${nodeName}.quaternion`;
      if (!existingTrackNames.has(trackName)) {
        if (this.vrm.scene.getObjectByName(nodeName)) {
          const values = [...q, ...q];
          newTracks.push(new THREE.QuaternionKeyframeTrack(trackName, times, values));
        }
      }
    }

    return new THREE.AnimationClip(idleClip.name, duration, newTracks);
  }

  constructor(vrm: VRM, idleClip: THREE.AnimationClip | null) {
    this.vrm = vrm;
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.cacheBones();
    this.buildFullBodyClips();

    // Setup Layer 1: Base Idle (Always active at weight 1.0, padded to match 51 tracks)
    if (idleClip) {
      const fullIdleClip = this.padIdleClip(idleClip);
      this.idleAction = this.mixer.clipAction(fullIdleClip);
    } else {
      const fallback = this.gestureClips.get("idle");
      if (fallback) this.idleAction = this.mixer.clipAction(fallback);
    }

    if (this.idleAction) {
      this.idleAction.reset();
      this.idleAction.setEffectiveWeight(1.0);
      this.idleAction.setLoop(THREE.LoopRepeat, Infinity);
      this.idleAction.play();
    }

    // Setup Layer 2: Gesture Actions
    for (const [name, clip] of this.gestureClips.entries()) {
      if (name === "idle") continue;
      const act = this.mixer.clipAction(clip);
      act.setLoop(THREE.LoopOnce, 1);
      act.clampWhenFinished = false; // Never clamp! Seamlessly return to idle.
      this.gestureActions.set(name, act);
    }

    // Subscribe to decoupled MotionEventBus
    if (MOTION_CONFIG.MOTION_V2) {
      this.unsubscribeBus = motionEventBus.subscribe((ev) => this.handleMotionEvent(ev));
    }
  }

  dispose(): void {
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }
  }

  setIdleClip(idleClip: THREE.AnimationClip | null): void {
    if (this.idleAction) {
      this.idleAction.stop();
      this.mixer.uncacheAction(this.idleAction.getClip());
      this.idleAction = null;
    }
    if (idleClip) {
      const fullIdleClip = this.padIdleClip(idleClip);
      this.idleAction = this.mixer.clipAction(fullIdleClip);
    } else {
      const fallback = this.gestureClips.get("idle");
      if (fallback) this.idleAction = this.mixer.clipAction(fallback);
    }
    if (this.idleAction) {
      this.idleAction.reset();
      this.idleAction.setEffectiveWeight(1.0);
      this.idleAction.setLoop(THREE.LoopRepeat, Infinity);
      this.idleAction.play();
    }
  }

  playCustomVrmaClip(clip: THREE.AnimationClip, customDuration?: number): void {
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }

    if (this.currentAction && this.currentAction !== this.idleAction) {
      this.currentAction.fadeOut(0.2);
    }

    const padded = this.padIdleClip(clip);
    const act = this.mixer.clipAction(padded);
    act.reset();
    act.setLoop(THREE.LoopOnce, 1);
    act.clampWhenFinished = false;
    act.fadeIn(0.3);
    act.play();

    this.currentAction = act;
    this.currentGesture = "explain";
    this.gestureTime = 0;
    this.gestureDuration = customDuration || Math.min(6.0, clip.duration || 3.0);
    this.isCrossFadingOut = false;

    this.fallbackTimer = setTimeout(() => {
      this.returnToIdle(0.4);
    }, (this.gestureDuration + 0.1) * 1000);
  }

  private cacheBones(): void {
    const humanoid = this.vrm.humanoid;
    if (!humanoid) return;

    const names = [
      "hips", "spine", "chest", "upperChest", "neck", "head",
      "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
      "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
      "leftUpperLeg", "leftLowerLeg", "leftFoot",
      "rightUpperLeg", "rightLowerLeg", "rightFoot",
      // Left 15 Finger Joints
      "leftThumbProximal", "leftThumbIntermediate", "leftThumbDistal",
      "leftIndexProximal", "leftIndexIntermediate", "leftIndexDistal",
      "leftMiddleProximal", "leftMiddleIntermediate", "leftMiddleDistal",
      "leftRingProximal", "leftRingIntermediate", "leftRingDistal",
      "leftLittleProximal", "leftLittleIntermediate", "leftLittleDistal",
      // Right 15 Finger Joints
      "rightThumbProximal", "rightThumbIntermediate", "rightThumbDistal",
      "rightIndexProximal", "rightIndexIntermediate", "rightIndexDistal",
      "rightMiddleProximal", "rightMiddleIntermediate", "rightMiddleDistal",
      "rightRingProximal", "rightRingIntermediate", "rightRingDistal",
      "rightLittleProximal", "rightLittleIntermediate", "rightLittleDistal"
    ];

    this.restQuats.clear();
    for (const n of names) {
      const node = humanoid.getNormalizedBoneNode(n as any);
      this.bones[n] = node;
      if (node) {
        this.restQuats.set(n, node.quaternion.clone());
      }
    }
  }

  // Decoupled MotionEventBus Handler
  private handleMotionEvent(event: MotionEvent): void {
    switch (event.type) {
      case "user:submit":
        if (this.fallbackTimer) {
          clearTimeout(this.fallbackTimer);
          this.fallbackTimer = null;
        }
        this.setConversationState("listening");
        break;
      case "llm:firstToken":
        this.setConversationState("speaking");
        // Mandated 300ms delay timer: if intent arrives before 300ms, cancel fallback
        if (this.fallbackTimer) {
          clearTimeout(this.fallbackTimer);
          this.fallbackTimer = null;
        }
        if (this.currentGesture === "idle") {
          this.fallbackTimer = setTimeout(() => {
            this.fallbackTimer = null;
            if (this.convState === "speaking" && this.currentGesture === "idle") {
              this.play("explain", true);
            }
          }, 300);
        }
        break;
      case "llm:intent":
        if (this.fallbackTimer) {
          clearTimeout(this.fallbackTimer);
          this.fallbackTimer = null;
        }
        this.applyIntent(event.payload);
        break;
      case "tts:start":
        this.setSpeaking(true);
        break;
      case "tts:end":
        if (this.fallbackTimer) {
          clearTimeout(this.fallbackTimer);
          this.fallbackTimer = null;
        }
        this.setSpeaking(false);
        if (this.convState === "speaking") {
          this.setConversationState("afterglow");
          this.returnToIdle(0.4);
        }
        break;
      case "llm:done":
        if (this.convState !== "speaking" && this.convState !== "afterglow") {
          this.setConversationState("idle");
        }
        break;
    }
  }

  /** 5-Stage Conversation State Machine */
  setConversationState(next: ConvState): void {
    if (this.convState === next) return;
    const prev = this.convState;
    this.convState = next;
    this.stateTimer = 0;
    console.log(`[ConvState Transition] ${new Date().toISOString()} ${prev} -> ${next}`);

    // Trigger transition micro-motion (0.3 ~ 0.6s)
    this.transitionMotionType = next;
    this.transitionMotionProgress = 0;
    this.transitionMotionDuration = next === "speaking" ? 0.35 : 0.45;
  }

  getConversationState(): ConvState {
    return this.convState;
  }

  applyIntent(intent: MotionIntentData): void {
    if (!intent) return;
    if (intent.gesture && intent.gesture !== "none") {
      const g = intent.gesture as GestureName;
      if (this.gestureActions.has(g)) {
        this.play(g, true); // fromIntent = true (smooth crossfade)
      }
    }
  }

  setSpeaking(speaking: boolean): void {
    if (this.isSpeaking === speaking) return;
    this.isSpeaking = speaking;

    if (speaking) {
      this.speechTimer = 0;
      this.speechIndex = 0;
      this.setConversationState("speaking");
      if (this.currentGesture === "idle" && !this.fallbackTimer) {
        this.play("explain", true);
      }
    } else {
      if (this.fallbackTimer) {
        clearTimeout(this.fallbackTimer);
        this.fallbackTimer = null;
      }
      // Audio finished: transition to afterglow (1.5s countdown before idle)
      this.setConversationState("afterglow");
      this.returnToIdle(0.4);
    }
  }

  /**
   * Play gesture layered over Base Idle:
   * Base Idle is ALWAYS maintained at weight 1.0 in the mixer background.
   */
  play(
    name: GestureName,
    _fromIntent: boolean | GestureTimingPayload = false
  ): void {
    const timing = typeof _fromIntent === "object" ? _fromIntent : undefined;

    // Safe spelling alias mapping only
    const SPELLING_MAP: Record<string, GestureName> = {
      thinking: "think",
    };
    if (SPELLING_MAP[name as string]) {
      name = SPELLING_MAP[name as string];
    }

    if (!name || this.knownGoodVrmaOnly || name === "idle") {
      this.gestureQueue = [];
      this.returnToIdle(0.4);
      return;
    }

    // Check same-gesture cooldown: prevent identical gesture rapid repetition
    const sameGestureCooldown = this.gestureCooldowns.get(name) ?? 0;
    if (sameGestureCooldown > 0 || this.currentGesture === name) {
      return;
    }

    // If currently busy with a gesture or global cooldown is active, buffer into bounded queue
    const isBusy = this.globalCooldown > 0 || (this.currentAction && this.currentGesture !== "idle" && !this.isCrossFadingOut);
    if (isBusy) {
      if (this.gestureQueue.length < this.MAX_QUEUE_SIZE && !this.gestureQueue.some(q => q.name === name)) {
        this.gestureQueue.push({
          name,
          queuedAt: performance.now(),
          timing,
          segmentId: timing?.segmentId,
          expiresAt: timing?.expiresAt,
        });
      }
      return;
    }

    this.executeGesture(name, timing);
  }

  /**
   * Directly activates AnimationAction with cross-fades, cooldown setup, and latency measurement
   */
  private executeGesture(name: GestureName, timing?: GestureTimingPayload): void {
    const targetAction = this.gestureActions.get(name);
    const clip = this.gestureClips.get(name);
    if (!targetAction || !clip) {
      console.warn(`[MotionDirector] Warning: Gesture '${name}' has no registered AnimationAction or Clip!`);
      return;
    }

    // Cross-fade out previous gesture if still active
    if (this.currentAction) {
      if (this.currentAction !== targetAction) {
        this.currentAction.fadeOut(0.3);
      } else {
        this.currentAction.reset();
      }
    }

    this.currentGesture = name;
    this.gestureTime = 0;
    const startOffset = GESTURE_START_OFFSETS[name] ?? 0;
    const maxDur = (name === "spin" || name === "shoot") ? 10.0 : GESTURE_MAX_DURATION;
    this.gestureDuration = Math.min(clip.duration - startOffset, maxDur);
    this.isCrossFadingOut = false;

    // Record history & Set cooldowns (8.0s same gesture, 1.8s global queue interval)
    this.recentHistory.push(name);
    if (this.recentHistory.length > 5) this.recentHistory.shift();
    this.gestureCooldowns.set(name, 8.0);
    this.globalCooldown = 1.8;

    targetAction.reset();
    targetAction.time = startOffset;
    targetAction.clampWhenFinished = true;
    targetAction.setLoop(THREE.LoopOnce, 1);
    targetAction.setEffectiveWeight(1);
    targetAction.play();
    if (this.idleAction) {
      this.idleAction.crossFadeTo(targetAction, 0.3, false);
    }
    this.currentAction = targetAction;

    // Instrumentation: measure LLM span complete -> AnimationAction started (using Date.now() for unified cross-process epoch)
    if (timing?.spanCompleteTime) {
      const animationStartTime = Date.now();
      const spanToEmitMs = (timing.gestureEmitTime ?? animationStartTime) - timing.spanCompleteTime;
      const emitToStartMs = animationStartTime - (timing.gestureEmitTime ?? animationStartTime);
      const totalSpanToMotionMs = animationStartTime - timing.spanCompleteTime;
      MotionLatencyTracker.record({
        spanToEmitMs,
        emitToStartMs,
        totalSpanToMotionMs,
        gesture: name,
      });
    }
  }

  private returnToIdle(duration: number = 0.4): void {
    if (this.idleAction) {
      this.idleAction.enabled = true;
      this.idleAction.play();
    }
    if (this.currentAction) {
      if (this.idleAction) {
        this.currentAction.crossFadeTo(this.idleAction, duration, false);
      } else {
        this.currentAction.fadeOut(duration);
      }
      this.currentAction = null;
    } else if (this.idleAction) {
      this.idleAction.fadeIn(duration);
    }
    this.currentGesture = "idle";
  }

  public notifySegmentEnded(segmentId: string): void {
    if (!segmentId) return;
    this.completedSegmentIds.add(segmentId);
    if (this.completedSegmentIds.size > 50) {
      const first = this.completedSegmentIds.values().next().value;
      if (first) this.completedSegmentIds.delete(first);
    }
    this.gestureQueue = this.gestureQueue.filter((q) => q.segmentId !== segmentId);
  }

  /**
   * Asynchronously load gesture clips (Official VRMA priority, with Mixamo FBX fallback)
   * Automatically extracts and retargets humanoid tracks via createVRMAnimationClip.
   */
  async loadGestureClips(loader?: any): Promise<void> {
    if (!loader) {
      loader = new GLTFLoader();
      loader.register((parser: any) => new VRMAnimationLoaderPlugin(parser));
    }

    const list: { name: GestureName; file: string }[] = [
      { name: "wave", file: "./vrma/mixamo/wave.fbx" },                  // Mixamo standing wave
      { name: "peace", file: "./VRMA_MotionPack/vrma/VRMA_03.vrma" },    // Official VRoid Peace sign
      { name: "laugh", file: "./VRMA_MotionPack/vrma/VRMA_03.vrma" },    // Official VRoid Peace / Happy
      { name: "explain", file: "./VRMA_MotionPack/vrma/VRMA_01.vrma" },  // Official VRoid Show full body
      { name: "cheer", file: "./VRMA_MotionPack/vrma/VRMA_01.vrma" },    // Official VRoid Show full body
      { name: "proud", file: "./VRMA_MotionPack/vrma/VRMA_06.vrma" },    // Official VRoid Model pose
      { name: "shoot", file: "./VRMA_MotionPack/vrma/VRMA_04.vrma" },    // Official VRoid Shoot (빵야 손총)
      { name: "spin", file: "./VRMA_MotionPack/vrma/VRMA_05.vrma" },     // Official VRoid Spin (360도 회전)
      { name: "think", file: "./vrma/mixamo/think.fbx" },                // Mixamo Thinking pose
      { name: "nod", file: "./vrma/mixamo/nod.fbx" },                    // Mixamo subtle quick nod
      { name: "bow", file: "./VRMA_MotionPack/vrma/VRMA_02.vrma" },      // Official VRoid Bow / Greeting (정중한 인사)
    ];

    for (const item of list) {
      try {
        let cleanClip: THREE.AnimationClip;
        if (item.file.endsWith(".vrma")) {
          const gltf = await loader.loadAsync(item.file);
          const vrmAnimations = gltf.userData.vrmAnimations ?? [gltf.userData.vrmAnimation];
          if (!vrmAnimations || vrmAnimations.length === 0 || !vrmAnimations[0]) {
            throw new Error(`No VRMAnimation data found in ${item.file}`);
          }
          const rawClip = createVRMAnimationClip(vrmAnimations[0], this.vrm);
          // Filter out Hips.position to maintain fixed camera framing and avoid root motion stage walk-offs
          const cleanTracks = rawClip.tracks.filter(
            (t) => !t.name.includes("Hips.position") && !t.name.includes("hips.position")
          );
          cleanClip = new THREE.AnimationClip(item.name, rawClip.duration, cleanTracks);
        } else {
          cleanClip = await loadMixamoAnimation(item.file, this.vrm, item.name);
        }

        this.gestureClips.set(item.name, cleanClip);

        const act = this.mixer.clipAction(cleanClip);
        act.setLoop(THREE.LoopOnce, 1);
        act.clampWhenFinished = true; // Rule 5: clampWhenFinished = true
        this.gestureActions.set(item.name, act);
        console.log(
          `[MotionDirector] Registered gesture '${item.name}' (${item.file.endsWith(".vrma") ? "Native VRMA" : "Mixamo FBX"}): duration ${cleanClip.duration.toFixed(2)}s, tracks: ${cleanClip.tracks.length}`
        );
      } catch (err) {
        console.warn(`[MotionDirector] Failed to load gesture ${item.name}:`, err);
      }
    }
  }

  update(delta: number): void {
    this.totalTime += delta;
    this.gestureTime += delta;
    this.stateTimer += delta;

    // Decay global gesture interval cooldown
    if (this.globalCooldown > 0) {
      this.globalCooldown = Math.max(0, this.globalCooldown - delta);
    }

    // Process bounded gesture scheduler when ready for next transition
    if (
      this.gestureQueue.length > 0 &&
      this.globalCooldown <= 0 &&
      (!this.currentAction || this.currentGesture === "idle" || this.isCrossFadingOut)
    ) {
      const nowEpoch = Date.now();
      while (this.gestureQueue.length > 0) {
        const item = this.gestureQueue[0];
        const isExpired = !!item.expiresAt && nowEpoch > item.expiresAt;
        const isCompleted = !!item.segmentId && this.completedSegmentIds.has(item.segmentId);
        const isLegacyTtl = !item.expiresAt && (performance.now() - item.queuedAt > this.QUEUE_ITEM_TTL_MS);
        if (isExpired || isCompleted || isLegacyTtl) {
          this.gestureQueue.shift();
        } else {
          break;
        }
      }
      if (this.gestureQueue.length > 0) {
        const next = this.gestureQueue.shift()!;
        const sameCd = this.gestureCooldowns.get(next.name) ?? 0;
        if (sameCd <= 0 && this.currentGesture !== next.name) {
          this.executeGesture(next.name, next.timing);
        }
      }
    }

    // State machine afterglow timeout -> return to idle
    if (this.convState === "afterglow" && this.stateTimer >= 1.5) {
      this.setConversationState("idle");
    }

    // Advance transition motion progress
    if (this.transitionMotionProgress < 1.0) {
      this.transitionMotionProgress = Math.min(
        1.0,
        this.transitionMotionProgress + delta / this.transitionMotionDuration
      );
    }

    // Decay gesture cooldowns
    for (const [g, val] of this.gestureCooldowns.entries()) {
      if (val > 0) {
        this.gestureCooldowns.set(g, Math.max(0, val - delta));
      }
    }

    this.mixer.update(delta);
    this.frameCounter++;
    // Invariant (Rule 4): idle effective weight + gesture effective weight >= 0.99 at all frames
    if (this.idleAction) {
      const idleW = this.idleAction.getEffectiveWeight();
      let gestW = 0;
      for (const act of this.gestureActions.values()) {
        if (act.isRunning()) {
          gestW += act.getEffectiveWeight();
        }
      }
      const sumW = idleW + gestW;
      if (sumW < 0.99) {
        console.warn(
          `[WEIGHT INVARIANT VIOLATION] frame=${this.frameCounter} idle=${idleW.toFixed(3)} gest=${gestW.toFixed(3)} sum=${sumW.toFixed(3)}`
        );
      }
    }

    // 1. Layer 2: Automatic Anticipatory Fade Return to Base Idle before gesture finishes
    if (this.currentAction && this.currentGesture !== "idle") {
      const returnWindow = 0.4;
      if (!this.isCrossFadingOut && this.gestureTime >= this.gestureDuration - returnWindow) {
        this.isCrossFadingOut = true;
        this.returnToIdle(returnWindow);
      }
    }

    // 2. Dynamic conversational body language (Only when actively speaking)
    if (this.isSpeaking && !this.knownGoodVrmaOnly) {
      this.speechTimer += delta;
      if (this.speechTimer > 4.2) {
        this.speechTimer = 0;
        this.speechIndex = (this.speechIndex + 1) % this.speechGestures.length;
        this.play(this.speechGestures[this.speechIndex]);
      }
    }

    // 3. Layer 4: Procedural Dynamics
    if (this.proceduralEnabled && !this.knownGoodVrmaOnly) {
      if (MOTION_CONFIG.MOTION_V2) {
        // V2 Canonical: Pure 3-factor dynamics (0.25Hz respiration, 0.08Hz head drift) + Transition micro-motions
        // Hand and finger poses are strictly owned by animation clip (VRMA)
        this.applyProceduralV2(delta);
      } else {
        // Legacy V1 path
        this.applyProceduralDynamics(delta);
        this.applyFluidWrists(delta);
        this.applyLivingFingers(delta);
      }
    }
  }

  /**
   * V2 Canonical Procedural Dynamics (Safe Rest-Relative Formula):
   * bone.quaternion.copy(restQuat).multiply(offsetQuat)
   *
   * User mandated strict clamps:
   * - Head yaw: ±8°, pitch: ±5°, roll: ±3°
   * - Neck: exactly half of head (yaw: ±4°, pitch: ±2.5°, roll: ±1.5°)
   * Zero cumulative multiplication. Zero runaway rotation.
   */
  private applyProceduralV2(_delta: number): void {
    const isGestureActive = this.currentAction &&
                            this.currentAction.isRunning() &&
                            this.currentAction.weight > 0.05;

    const t = this.totalTime;

    // 1. Respiration (0.25Hz = 4.0s period)
    const respPhase = t * 2 * Math.PI * 0.25;
    const breathChest = Math.sin(respPhase) * (1.5 * Math.PI / 180);   // 1.5° on X
    const breathSpine = Math.sin(respPhase) * (0.5 * Math.PI / 180);   // 0.5° on X
    const breathShoulder = Math.sin(respPhase - 0.4) * (0.35 * Math.PI / 180); // phase-delayed shoulder lift

    // 2. Head & Neck Drift Multi-harmonics
    const driftPhase = t * 2 * Math.PI * 0.08;
    let rawHeadPitch = Math.sin(driftPhase * 0.9) * 0.016 + Math.cos(driftPhase * 0.4) * 0.008;
    let rawHeadYaw = Math.cos(driftPhase * 0.7) * 0.018 + Math.sin(driftPhase * 0.3) * 0.009;
    let rawHeadRoll = Math.sin(driftPhase * 0.5) * 0.008;

    let transChestPitch = 0;
    let transSpinePitch = 0;

    // 3. State Transition Micro-Motions (0.3 ~ 0.6s)
    if (this.transitionMotionProgress < 1.0 && this.transitionMotionType) {
      const bell = Math.sin(this.transitionMotionProgress * Math.PI);
      switch (this.transitionMotionType) {
        case "listening": {
          rawHeadRoll += bell * 0.03;
          break;
        }
        case "thinking": {
          transChestPitch -= bell * 0.015;
          rawHeadPitch += bell * 0.025;
          rawHeadYaw += bell * 0.02;
          break;
        }
        case "speaking": {
          rawHeadPitch += bell * 0.04;
          break;
        }
        case "afterglow": {
          transSpinePitch += bell * 0.01;
          break;
        }
      }
    }

    // Strict Clamps:
    // Head: yaw ±8° (0.1396 rad), pitch ±5° (0.0873 rad), roll ±3° (0.0524 rad)
    const DEG2RAD = Math.PI / 180;
    const clampedHeadYaw = THREE.MathUtils.clamp(rawHeadYaw, -8 * DEG2RAD, 8 * DEG2RAD);
    const clampedHeadPitch = THREE.MathUtils.clamp(rawHeadPitch, -5 * DEG2RAD, 5 * DEG2RAD);
    const clampedHeadRoll = THREE.MathUtils.clamp(rawHeadRoll, -3 * DEG2RAD, 3 * DEG2RAD);

    // Neck: exactly half of head (yaw ±4°, pitch ±2.5°, roll ±1.5°)
    const clampedNeckYaw = THREE.MathUtils.clamp(clampedHeadYaw * 0.5, -4 * DEG2RAD, 4 * DEG2RAD);
    const clampedNeckPitch = THREE.MathUtils.clamp(clampedHeadPitch * 0.5, -2.5 * DEG2RAD, 2.5 * DEG2RAD);
    const clampedNeckRoll = THREE.MathUtils.clamp(clampedHeadRoll * 0.5, -1.5 * DEG2RAD, 1.5 * DEG2RAD);

    // Apply strictly in bone.quaternion.copy(restQuat).multiply(offsetQuat) pattern!
    // Head
    const head = this.bones["head"];
    const headRest = this.restQuats.get("head");
    if (head && headRest) {
      if (!isGestureActive) {
        _scratchEuler.set(clampedHeadPitch, clampedHeadYaw, clampedHeadRoll);
        _scratchQuat.setFromEuler(_scratchEuler);
        head.quaternion.copy(headRest).multiply(_scratchQuat);
      }
    }

    // Neck
    const neck = this.bones["neck"];
    const neckRest = this.restQuats.get("neck");
    if (neck && neckRest) {
      if (!isGestureActive) {
        _scratchEuler.set(clampedNeckPitch, clampedNeckYaw, clampedNeckRoll);
        _scratchQuat.setFromEuler(_scratchEuler);
        neck.quaternion.copy(neckRest).multiply(_scratchQuat);
      }
    }

    // Chest
    const chest = this.bones["chest"];
    const chestRest = this.restQuats.get("chest");
    if (chest && chestRest) {
      if (!isGestureActive) {
        _scratchEuler.set(breathChest * 0.7 + transChestPitch, 0, 0);
        _scratchQuat.setFromEuler(_scratchEuler);
        chest.quaternion.copy(chestRest).multiply(_scratchQuat);
      }
    }

    // UpperChest
    const upperChest = this.bones["upperChest"];
    const upperChestRest = this.restQuats.get("upperChest");
    if (upperChest && upperChestRest) {
      if (!isGestureActive) {
        _scratchEuler.set(breathChest * 0.3, 0, 0);
        _scratchQuat.setFromEuler(_scratchEuler);
        upperChest.quaternion.copy(upperChestRest).multiply(_scratchQuat);
      }
    }

    // Spine
    const spine = this.bones["spine"];
    const spineRest = this.restQuats.get("spine");
    if (spine && spineRest) {
      if (!isGestureActive) {
        _scratchEuler.set(breathSpine + transSpinePitch, 0, 0);
        _scratchQuat.setFromEuler(_scratchEuler);
        spine.quaternion.copy(spineRest).multiply(_scratchQuat);
      }
    }

    // Shoulders
    const leftShoulder = this.bones["leftShoulder"];
    const leftShoulderRest = this.restQuats.get("leftShoulder");
    if (leftShoulder && leftShoulderRest) {
      if (!isGestureActive) {
        _scratchEuler.set(0, 0, breathShoulder);
        _scratchQuat.setFromEuler(_scratchEuler);
        leftShoulder.quaternion.copy(leftShoulderRest).multiply(_scratchQuat);
      }
    }
    const rightShoulder = this.bones["rightShoulder"];
    const rightShoulderRest = this.restQuats.get("rightShoulder");
    if (rightShoulder && rightShoulderRest) {
      if (!isGestureActive) {
        _scratchEuler.set(0, 0, -breathShoulder);
        _scratchQuat.setFromEuler(_scratchEuler);
        rightShoulder.quaternion.copy(rightShoulderRest).multiply(_scratchQuat);
      }
    }
  }

  /** Diagnostics & Rig Inspection Status (Work Order Section 16 & 17) */
  getDebugStatus() {
    return {
      v2: MOTION_CONFIG.MOTION_V2,
      convState: this.convState,
      gesture: this.currentGesture,
      cooldown: this.globalCooldown.toFixed(1) + "s",
      time: `${this.gestureTime.toFixed(1)}s / ${this.gestureDuration.toFixed(1)}s`,
      gestureWeight: this.currentAction ? this.currentAction.getEffectiveWeight().toFixed(2) : "0.00",
      idleWeight: this.idleAction ? this.idleAction.getEffectiveWeight().toFixed(2) : "0.00",
      isSpeaking: this.isSpeaking,
      procedural: this.proceduralEnabled,
      knownGoodVrmaOnly: this.knownGoodVrmaOnly,
    };
  }

  setKnownGoodVrmaOnly(enabled: boolean): void {
    this.knownGoodVrmaOnly = enabled;
    if (enabled) {
      this.returnToIdle(0.1);
    }
  }

  toggleProcedural(): boolean {
    this.proceduralEnabled = !this.proceduralEnabled;
    return this.proceduralEnabled;
  }

  /** Multi-harmonic natural respiration and pelvic weight shift */
  private applyProceduralDynamics(_delta: number): void {
    const t = this.totalTime;
    const breath = Math.sin(t * 1.4) * 0.012 + Math.sin(t * 2.2) * 0.003;
    const hipSway = Math.sin(t * 0.7) * 0.009;
    const neckBreath = Math.sin(t * 1.4 - 0.2) * 0.005;

    const chest = this.bones["chest"];
    if (chest) {
      chest.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(breath, 0, 0)));
      chest.quaternion.normalize();
    }

    const neck = this.bones["neck"];
    if (neck) {
      neck.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(neckBreath, 0, 0)));
      neck.quaternion.normalize();
    }

    const hips = this.bones["hips"];
    if (hips) {
      hips.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, hipSway, 0)));
      hips.quaternion.normalize();
    }
  }

  /** Smooth trigonometric wrist trajectories */
  private applyFluidWrists(delta: number): void {
    const t = this.totalTime;
    const gt = this.gestureTime;
    const lerpSpeed = Math.min(1, delta * 12.0);

    const L_REST_EULER = new THREE.Euler(-0.35, -0.03, 0.01);
    const R_REST_EULER = new THREE.Euler(-0.28, 0.04, -0.03);

    let lEuler = L_REST_EULER.clone();
    let rEuler = R_REST_EULER.clone();

    const wristBreath = Math.sin(t * 1.5) * 0.02;
    lEuler.x += wristBreath;
    rEuler.x += wristBreath;

    if (this.currentGesture === "wave") {
      const waveAngle = Math.sin(gt * 7.5) * 0.42;
      rEuler.set(0.22, 0.15, waveAngle);
    } else if (this.currentGesture === "talk") {
      const talkCycle = Math.sin(gt * 3.0);
      rEuler.set(0.28 + talkCycle * 0.08, 0.18 + Math.cos(gt * 3.0) * 0.06, -0.25 + talkCycle * 0.1);
      lEuler.set(0.20 + talkCycle * 0.05, -0.12, 0.12 + talkCycle * 0.05);
    } else if (this.currentGesture === "peace") {
      rEuler.set(0.35, 0.15, 0.28);
    } else if (this.currentGesture === "cheer") {
      rEuler.set(0.28, 0.18, -0.22);
      lEuler.set(0.28, -0.18, 0.22);
    } else if (this.currentGesture === "thinking") {
      rEuler.set(0.38, 0.25, 0.22);
      lEuler.set(0.18, -0.12, 0.22);
    } else if (this.currentGesture === "shy") {
      rEuler.set(0.25, 0.2, 0.25);
      lEuler.set(0.25, -0.2, -0.25);
    } else if (this.currentGesture === "sing") {
      rEuler.set(0.28, 0.2, 0.15);
      lEuler.set(0.20, -0.15, 0.18);
    } else if (this.currentGesture === "bow") {
      rEuler.set(0.18, 0.06, -0.06);
      lEuler.set(0.18, -0.06, 0.06);
    } else if (this.currentGesture === "curious") {
      rEuler.set(0.26, 0.16, 0.14);
      lEuler.set(0.22, -0.08, 0.05);
    } else if (this.currentGesture === "giggle") {
      const giggleFlutter = Math.sin(gt * 12.0) * 0.03;
      rEuler.set(0.42 + giggleFlutter, 0.24, 0.32);
    } else if (this.currentGesture === "proud") {
      rEuler.set(-0.12, 0.22, -0.28);
      lEuler.set(-0.12, -0.22, 0.28);
    }

    this.leftWristTarget.setFromEuler(lEuler);
    this.rightWristTarget.setFromEuler(rEuler);

    const lHand = this.bones["leftHand"];
    const rHand = this.bones["rightHand"];
    if (lHand) lHand.quaternion.slerp(this.leftWristTarget, lerpSpeed);
    if (rHand) rHand.quaternion.slerp(this.rightWristTarget, lerpSpeed);
  }

  /** 30-joint living cascading finger dynamics */
  private applyLivingFingers(delta: number): void {
    const t = this.totalTime;
    const gt = this.gestureTime;
    const isPeace = this.currentGesture === "peace";
    const isWave = this.currentGesture === "wave";
    const isGiggle = this.currentGesture === "giggle";
    const isBow = this.currentGesture === "bow";
    const isProud = this.currentGesture === "proud";
    const lerpSpeed = Math.min(1, delta * 12.0);

    const fingers = [
      { name: "Index", baseCurl: 0.32, spread: 0.05, idx: 1 },
      { name: "Middle", baseCurl: 0.35, spread: 0.00, idx: 2 },
      { name: "Ring", baseCurl: 0.38, spread: -0.04, idx: 3 },
      { name: "Little", baseCurl: 0.42, spread: -0.08, idx: 4 },
    ];

    const speechPulse = this.isSpeaking ? (Math.sin(t * 3.0) * 0.5 + 0.5) * 0.16 : 0;
    const waveInertiaLag = isWave ? Math.sin(gt * 7.5 - 0.45) * 0.22 : 0;

    for (const f of fingers) {
      const flutter = Math.sin(t * 1.6 + f.idx * 0.35) * 0.035;

      let curlL = f.baseCurl + flutter - speechPulse;
      let curlR = f.baseCurl + flutter - speechPulse;

      if (isWave) curlR += waveInertiaLag;

      if (isPeace) {
        curlR = (f.name === "Index" || f.name === "Middle") ? 0.03 : 0.95;
      } else if (isGiggle) {
        curlR = 0.55 + Math.sin(gt * 10.0 + f.idx * 0.2) * 0.04;
      } else if (isBow) {
        curlL = 0.18; curlR = 0.18;
      } else if (isProud) {
        curlL = 0.48; curlR = 0.48;
      }

      const lP = this.bones[`left${f.name}Proximal`];
      const lI = this.bones[`left${f.name}Intermediate`];
      const lD = this.bones[`left${f.name}Distal`];
      if (lP) lP.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, f.spread, curlL)), lerpSpeed);
      if (lI) lI.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, curlL * 1.2)), lerpSpeed);
      if (lD) lD.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, curlL * 0.8)), lerpSpeed);

      const rP = this.bones[`right${f.name}Proximal`];
      const rI = this.bones[`right${f.name}Intermediate`];
      const rD = this.bones[`right${f.name}Distal`];
      if (rP) rP.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -f.spread, -curlR)), lerpSpeed);
      if (rI) rI.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -curlR * 1.2)), lerpSpeed);
      if (rD) rD.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -curlR * 0.8)), lerpSpeed);
    }

    // Thumbs
    let thumbFoldL = 0.28 + Math.sin(t * 1.5) * 0.03;
    let thumbFoldR = 0.28 + Math.sin(t * 1.5) * 0.03;
    if (isPeace) thumbFoldR = 0.55;
    else if (isProud) { thumbFoldL = 0.45; thumbFoldR = 0.45; }

    const lTP = this.bones["leftThumbProximal"];
    const lTI = this.bones["leftThumbIntermediate"];
    const lTD = this.bones["leftThumbDistal"];
    if (lTP) lTP.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, 0.25, thumbFoldL)), lerpSpeed);
    if (lTI) lTI.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, thumbFoldL * 1.1)), lerpSpeed);
    if (lTD) lTD.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, thumbFoldL * 0.7)), lerpSpeed);

    const rTP = this.bones["rightThumbProximal"];
    const rTI = this.bones["rightThumbIntermediate"];
    const rTD = this.bones["rightThumbDistal"];
    if (rTP) rTP.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, -0.25, -thumbFoldR)), lerpSpeed);
    if (rTI) rTI.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -thumbFoldR * 1.1)), lerpSpeed);
    if (rTD) rTD.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -thumbFoldR * 0.7)), lerpSpeed);
  }

  private addTrack(
    tracks: THREE.KeyframeTrack[],
    boneName: string,
    times: number[],
    eulers: THREE.Euler[]
  ): void {
    const node = this.bones[boneName];
    if (!node) return;
    const values: number[] = [];
    const q = new THREE.Quaternion();
    for (const eu of eulers) {
      q.setFromEuler(eu);
      values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values));
  }

  /**
   * Full-Body Humanoid Kinetic Chain Clips
   * Integrates Hips, Spine, Chest, Shoulders, Arms, Neck, and Head into organic, breathing gestures.
   */
  private buildFullBodyClips(): void {
    const e = (x: number, y: number, z: number) => new THREE.Euler(x, y, z);

    // True Mocap Humanoid Rest Pose (Arms down along hips, zero T-pose divergence)
    const L_REST_UPPER = e(-0.06, -0.09, -1.33);
    const R_REST_UPPER = e(-0.13, 0.11, 1.29);
    const L_REST_LOWER = e(0.00, -0.10, 0.02);
    const R_REST_LOWER = e(0.00, 0.12, -0.02);
    const ZERO = e(0, 0, 0);

    // 1. Procedural Idle fallback
    {
      const t = [0, 1.8, 3.6];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "chest", t, [ZERO, e(0.02, 0, 0), ZERO]);
      this.addTrack(tr, "neck", t, [ZERO, e(0.01, 0, 0), ZERO]);
      this.addTrack(tr, "leftUpperArm", t, [L_REST_UPPER, L_REST_UPPER, L_REST_UPPER]);
      this.addTrack(tr, "rightUpperArm", t, [R_REST_UPPER, R_REST_UPPER, R_REST_UPPER]);
      this.addTrack(tr, "leftLowerArm", t, [L_REST_LOWER, L_REST_LOWER, L_REST_LOWER]);
      this.addTrack(tr, "rightLowerArm", t, [R_REST_LOWER, R_REST_LOWER, R_REST_LOWER]);
      this.gestureClips.set("idle", new THREE.AnimationClip("md-idle", 3.6, tr));
    }

    // 2. Wave: Full-Body Wave with Clavicle Elevation, Hips Weight Shift, and Cute Head Tilt
    {
      const t = [0, 0.2, 0.45, 1.0, 1.5, 2.0, 2.4, 2.8];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "hips", [0, 0.45, 2.0, 2.8], [ZERO, e(0, -0.04, 0.02), e(0, -0.04, 0.02), ZERO]);
      this.addTrack(tr, "chest", [0, 0.45, 2.0, 2.8], [ZERO, e(0.03, -0.06, -0.03), e(0.03, -0.06, -0.03), ZERO]);
      this.addTrack(tr, "neck", [0, 0.45, 1.2, 2.0, 2.8], [ZERO, e(0.02, 0.04, 0.12), e(0.01, 0.03, 0.14), e(0.02, 0.04, 0.12), ZERO]);
      this.addTrack(tr, "rightShoulder", [0, 0.2, 0.45, 2.0, 2.8], [ZERO, e(0, 0, -0.08), e(0, 0, -0.18), e(0, 0, -0.18), ZERO]);
      this.addTrack(tr, "rightUpperArm", t, [
        R_REST_UPPER, e(0.2, 0.1, 0.8), e(0.65, 0.35, 0.15), e(0.60, 0.32, 0.10),
        e(0.65, 0.35, 0.15), e(0.60, 0.32, 0.10), e(0.3, 0.15, 0.7), R_REST_UPPER
      ]);
      this.addTrack(tr, "rightLowerArm", t, [
        R_REST_LOWER, e(0.1, 0.1, -0.4), e(0.40, 0.20, -1.65), e(0.35, 0.18, -1.50),
        e(0.40, 0.20, -1.65), e(0.35, 0.18, -1.50), e(0.2, 0.1, -0.8), R_REST_LOWER
      ]);
      this.addTrack(tr, "leftUpperArm", [0, 0.45, 2.0, 2.8], [L_REST_UPPER, L_REST_UPPER, L_REST_UPPER, L_REST_UPPER]);
      this.gestureClips.set("wave", new THREE.AnimationClip("md-wave", 2.8, tr));
    }

    // 3. Talk: Conversational cadence with organic asymmetrical torso rhythm
    {
      const t = [0, 0.35, 0.8, 1.3, 1.8, 2.3];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "hips", [0, 0.35, 1.3, 2.3], [ZERO, e(0, 0.03, 0), e(0, -0.02, 0), ZERO]);
      this.addTrack(tr, "chest", t, [ZERO, e(0.05, 0.03, 0), e(0.02, -0.01, 0), e(0.05, 0.03, 0), e(0.02, -0.01, 0), ZERO]);
      this.addTrack(tr, "neck", t, [ZERO, e(0.04, 0.02, 0.02), e(-0.02, -0.02, -0.01), e(0.05, 0.02, 0.02), e(-0.01, 0, 0), ZERO]);
      this.addTrack(tr, "rightShoulder", [0, 0.35, 1.8, 2.3], [ZERO, e(0, 0, -0.06), e(0, 0, -0.06), ZERO]);
      this.addTrack(tr, "rightUpperArm", t, [
        R_REST_UPPER, e(0.35, 0.18, 0.65), e(0.25, 0.12, 0.85), e(0.38, 0.20, 0.60), e(0.28, 0.14, 0.80), R_REST_UPPER
      ]);
      this.addTrack(tr, "rightLowerArm", t, [
        R_REST_LOWER, e(0.35, 0.15, -0.95), e(0.20, 0.10, -0.55), e(0.38, 0.18, -1.00), e(0.25, 0.12, -0.65), R_REST_LOWER
      ]);
      this.addTrack(tr, "leftUpperArm", t, [
        L_REST_UPPER, e(0.12, -0.08, -1.25), e(0.18, -0.12, -1.18), e(0.14, -0.08, -1.24), e(0.16, -0.10, -1.20), L_REST_UPPER
      ]);
      this.addTrack(tr, "leftLowerArm", t, [
        L_REST_LOWER, e(0.18, -0.08, 0.35), e(0.25, -0.12, 0.48), e(0.18, -0.08, 0.35), e(0.22, -0.10, 0.42), L_REST_LOWER
      ]);
      this.gestureClips.set("talk", new THREE.AnimationClip("md-talk", 2.3, tr));
    }

    // 4. Peace: High V sign with playful head tilt and chest angle
    {
      const t = [0, 0.32, 0.5, 1.8, 2.4];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "hips", [0, 0.32, 1.8, 2.4], [ZERO, e(0, 0.04, -0.02), e(0, 0.04, -0.02), ZERO]);
      this.addTrack(tr, "chest", [0, 0.32, 1.8, 2.4], [ZERO, e(0.04, 0.05, 0.02), e(0.04, 0.05, 0.02), ZERO]);
      this.addTrack(tr, "neck", [0, 0.32, 1.8, 2.4], [ZERO, e(0.03, -0.04, -0.14), e(0.03, -0.04, -0.14), ZERO]);
      this.addTrack(tr, "rightShoulder", [0, 0.32, 1.8, 2.4], [ZERO, e(0, 0, -0.15), e(0, 0, -0.15), ZERO]);
      this.addTrack(tr, "rightUpperArm", t, [
        R_REST_UPPER, e(0.65, 0.35, 0.15), e(0.60, 0.32, 0.12), e(0.60, 0.32, 0.12), R_REST_UPPER
      ]);
      this.addTrack(tr, "rightLowerArm", t, [
        R_REST_LOWER, e(0.40, 0.22, -1.95), e(0.35, 0.18, -1.82), e(0.35, 0.18, -1.82), R_REST_LOWER
      ]);
      this.addTrack(tr, "leftUpperArm", [0, 0.32, 1.8, 2.4], [L_REST_UPPER, L_REST_UPPER, L_REST_UPPER, L_REST_UPPER]);
      this.gestureClips.set("peace", new THREE.AnimationClip("md-peace", 2.4, tr));
    }

    // 5. Cheer: Double arm celebration with energetic torso bounce
    {
      const t = [0, 0.35, 0.7, 1.1, 1.5, 1.9, 2.4];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "chest", t, [ZERO, e(0.08, 0, 0), e(0.04, 0, 0), e(0.09, 0, 0), e(0.04, 0, 0), e(0.07, 0, 0), ZERO]);
      this.addTrack(tr, "neck", [0, 0.35, 1.1, 1.9, 2.4], [ZERO, e(-0.06, 0, 0), e(-0.04, 0, 0), e(-0.06, 0, 0), ZERO]);
      this.addTrack(tr, "rightShoulder", [0, 0.35, 1.9, 2.4], [ZERO, e(0, 0, -0.18), e(0, 0, -0.18), ZERO]);
      this.addTrack(tr, "leftShoulder", [0, 0.35, 1.9, 2.4], [ZERO, e(0, 0, 0.18), e(0, 0, 0.18), ZERO]);
      this.addTrack(tr, "rightUpperArm", t, [
        R_REST_UPPER, e(0.70, 0.25, 0.15), e(0.65, 0.20, 0.12), e(0.72, 0.25, 0.15),
        e(0.65, 0.20, 0.12), e(0.70, 0.22, 0.14), R_REST_UPPER
      ]);
      this.addTrack(tr, "leftUpperArm", t, [
        L_REST_UPPER, e(0.70, -0.25, -0.15), e(0.65, -0.20, -0.12), e(0.72, -0.25, -0.15),
        e(0.65, -0.20, -0.12), e(0.70, -0.22, -0.14), L_REST_UPPER
      ]);
      this.addTrack(tr, "rightLowerArm", t, [
        R_REST_LOWER, e(0.45, 0.20, -1.15), e(0.38, 0.15, -1.00), e(0.48, 0.22, -1.18),
        e(0.38, 0.15, -1.00), e(0.42, 0.18, -1.10), R_REST_LOWER
      ]);
      this.addTrack(tr, "leftLowerArm", t, [
        L_REST_LOWER, e(0.45, -0.20, 1.15), e(0.38, -0.15, 1.00), e(0.48, -0.22, 1.18),
        e(0.38, -0.15, 1.00), e(0.42, -0.18, 1.10), L_REST_LOWER
      ]);
      this.gestureClips.set("cheer", new THREE.AnimationClip("md-cheer", 2.4, tr));
    }

    // 6. Thinking: Right hand to chin with thoughtful lean and head tilt
    {
      const t = [0, 0.45, 1.2, 2.0, 2.6];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "chest", [0, 0.45, 2.0, 2.6], [ZERO, e(0.04, -0.05, 0.03), e(0.04, -0.05, 0.03), ZERO]);
      this.addTrack(tr, "neck", [0, 0.45, 2.0, 2.6], [ZERO, e(0.04, -0.06, -0.15), e(0.04, -0.06, -0.15), ZERO]);
      this.addTrack(tr, "rightShoulder", [0, 0.45, 2.0, 2.6], [ZERO, e(0, 0, -0.08), e(0, 0, -0.08), ZERO]);
      this.addTrack(tr, "rightUpperArm", t, [
        R_REST_UPPER, e(0.65, 0.25, 0.25), e(0.62, 0.22, 0.22), e(0.64, 0.24, 0.24), R_REST_UPPER
      ]);
      this.addTrack(tr, "rightLowerArm", t, [
        R_REST_LOWER, e(0.38, 0.15, -2.02), e(0.35, 0.12, -1.95), e(0.36, 0.14, -1.98), R_REST_LOWER
      ]);
      this.addTrack(tr, "leftUpperArm", t, [
        L_REST_UPPER, e(0.20, -0.12, -1.25), e(0.18, -0.10, -1.26), e(0.18, -0.10, -1.26), L_REST_UPPER
      ]);
      this.addTrack(tr, "leftLowerArm", t, [
        L_REST_LOWER, e(0.25, -0.15, 0.45), e(0.22, -0.12, 0.42), e(0.22, -0.12, 0.42), L_REST_LOWER
      ]);
      this.gestureClips.set("thinking", new THREE.AnimationClip("md-thinking", 2.6, tr));
    }

    // 7. Shy: Modest clasped arms with bashfully lowered head
    {
      const t = [0, 0.45, 1.9, 2.5];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "chest", t, [ZERO, e(-0.05, 0, 0), e(-0.05, 0, 0), ZERO]);
      this.addTrack(tr, "neck", [0, 0.45, 1.9, 2.5], [ZERO, e(0.08, 0.02, 0.06), e(0.08, 0.02, 0.06), ZERO]);
      this.addTrack(tr, "rightUpperArm", t, [R_REST_UPPER, e(0.25, 0.12, 0.95), e(0.25, 0.12, 0.95), R_REST_UPPER]);
      this.addTrack(tr, "leftUpperArm", t, [L_REST_UPPER, e(0.25, -0.12, -0.95), e(0.25, -0.12, -0.95), L_REST_UPPER]);
      this.addTrack(tr, "rightLowerArm", t, [R_REST_LOWER, e(0.35, 0.05, -0.95), e(0.35, 0.05, -0.95), R_REST_LOWER]);
      this.addTrack(tr, "leftLowerArm", t, [L_REST_LOWER, e(0.35, -0.05, 0.95), e(0.35, -0.05, 0.95), L_REST_LOWER]);
      this.gestureClips.set("shy", new THREE.AnimationClip("md-shy", 2.5, tr));
    }

    // 8. Sing: Idol singing pose with rhythmic torso bounce
    {
      const t = [0, 0.45, 1.0, 1.5, 2.0, 2.5];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "chest", t, [ZERO, e(0.06, 0.04, 0.02), e(0.03, -0.02, -0.01), e(0.06, 0.04, 0.02), e(0.04, 0.01, 0), ZERO]);
      this.addTrack(tr, "neck", [0, 0.45, 1.0, 1.5, 2.0, 2.5], [ZERO, e(0.03, 0.04, 0.06), e(-0.02, -0.02, -0.04), e(0.03, 0.04, 0.06), e(0, 0, 0), ZERO]);
      this.addTrack(tr, "rightShoulder", [0, 0.45, 2.0, 2.5], [ZERO, e(0, 0, -0.10), e(0, 0, -0.10), ZERO]);
      this.addTrack(tr, "rightUpperArm", t, [
        R_REST_UPPER, e(0.65, 0.28, 0.25), e(0.60, 0.25, 0.22), e(0.65, 0.28, 0.25), e(0.62, 0.26, 0.24), R_REST_UPPER
      ]);
      this.addTrack(tr, "rightLowerArm", t, [
        R_REST_LOWER, e(0.38, 0.18, -1.82), e(0.32, 0.14, -1.72), e(0.38, 0.18, -1.82), e(0.34, 0.16, -1.76), R_REST_LOWER
      ]);
      this.addTrack(tr, "leftUpperArm", t, [
        L_REST_UPPER, e(0.20, -0.12, -1.25), e(0.18, -0.10, -1.26), e(0.20, -0.12, -1.25), e(0.18, -0.10, -1.26), L_REST_UPPER
      ]);
      this.addTrack(tr, "leftLowerArm", t, [
        L_REST_LOWER, e(0.22, -0.12, 0.45), e(0.18, -0.10, 0.40), e(0.22, -0.12, 0.45), e(0.20, -0.10, 0.42), L_REST_LOWER
      ]);
      this.gestureClips.set("sing", new THREE.AnimationClip("md-sing", 2.5, tr));
    }

    // 9. Nod: Double affirmative nod with spine and neck integration
    {
      const t = [0, 0.28, 0.50, 0.78, 1.0, 1.35];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "chest", t, [ZERO, e(0.14, 0, 0), e(-0.03, 0, 0), e(0.08, 0, 0), e(-0.01, 0, 0), ZERO]);
      this.addTrack(tr, "neck", t, [ZERO, e(0.16, 0, 0), e(-0.04, 0, 0), e(0.09, 0, 0), e(-0.02, 0, 0), ZERO]);
      this.gestureClips.set("nod", new THREE.AnimationClip("md-nod", 1.35, tr));
    }

    // 10. Bow: Japanese-style polite bow with full spine, chest, and thigh alignment
    {
      const t = [0, 0.38, 0.9, 1.5, 2.0, 2.5];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "hips", [0, 0.38, 0.9, 2.0, 2.5], [ZERO, e(0.06, 0, 0), e(0.06, 0, 0), ZERO, ZERO]);
      this.addTrack(tr, "chest", t, [ZERO, e(0.24, 0, 0), e(0.26, 0, 0), e(0.14, 0, 0), e(-0.02, 0, 0), ZERO]);
      this.addTrack(tr, "neck", t, [ZERO, e(0.12, 0, 0), e(0.13, 0, 0), e(0.06, 0, 0), e(-0.01, 0, 0), ZERO]);
      this.addTrack(tr, "rightUpperArm", t, [R_REST_UPPER, R_REST_UPPER, R_REST_UPPER, R_REST_UPPER, R_REST_UPPER, R_REST_UPPER]);
      this.addTrack(tr, "leftUpperArm", t, [L_REST_UPPER, L_REST_UPPER, L_REST_UPPER, L_REST_UPPER, L_REST_UPPER, L_REST_UPPER]);
      this.addTrack(tr, "rightLowerArm", t, [R_REST_LOWER, R_REST_LOWER, R_REST_LOWER, R_REST_LOWER, R_REST_LOWER, R_REST_LOWER]);
      this.addTrack(tr, "leftLowerArm", t, [L_REST_LOWER, L_REST_LOWER, L_REST_LOWER, L_REST_LOWER, L_REST_LOWER, L_REST_LOWER]);
      this.gestureClips.set("bow", new THREE.AnimationClip("md-bow", 2.5, tr));
    }

    // 11. Curious: Leaning forward, head tilt, inquisitive right hand
    {
      const t = [0, 0.35, 1.5, 2.2];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "hips", t, [ZERO, e(0.04, 0.02, 0), e(0.04, 0.02, 0), ZERO]);
      this.addTrack(tr, "chest", t, [ZERO, e(0.08, 0.04, 0.02), e(0.08, 0.04, 0.02), ZERO]);
      this.addTrack(tr, "neck", t, [ZERO, e(0.05, 0.08, 0.18), e(0.05, 0.08, 0.18), ZERO]);
      this.addTrack(tr, "rightUpperArm", t, [
        R_REST_UPPER, e(0.32, 0.16, 0.75), e(0.32, 0.16, 0.75), R_REST_UPPER
      ]);
      this.addTrack(tr, "rightLowerArm", t, [
        R_REST_LOWER, e(0.30, 0.12, -0.85), e(0.30, 0.12, -0.85), R_REST_LOWER
      ]);
      this.addTrack(tr, "leftUpperArm", t, [L_REST_UPPER, L_REST_UPPER, L_REST_UPPER, L_REST_UPPER]);
      this.addTrack(tr, "leftLowerArm", t, [L_REST_LOWER, L_REST_LOWER, L_REST_LOWER, L_REST_LOWER]);
      this.gestureClips.set("curious", new THREE.AnimationClip("md-curious", 2.2, tr));
    }

    // 12. Giggle: Hand covering mouth with triple bounce chuckling
    {
      const t = [0, 0.28, 0.55, 0.82, 1.1, 1.6, 2.2];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "chest", t, [ZERO, e(0.06, 0, 0), e(0.02, 0, 0), e(0.07, 0, 0), e(0.02, 0, 0), e(0.05, 0, 0), ZERO]);
      this.addTrack(tr, "neck", [0, 0.28, 1.6, 2.2], [ZERO, e(0.09, 0.04, -0.08), e(0.09, 0.04, -0.08), ZERO]);
      this.addTrack(tr, "rightShoulder", [0, 0.28, 1.6, 2.2], [ZERO, e(0, 0, -0.12), e(0, 0, -0.12), ZERO]);
      this.addTrack(tr, "rightUpperArm", [0, 0.28, 1.6, 2.2], [
        R_REST_UPPER, e(0.70, 0.25, 0.20), e(0.70, 0.25, 0.20), R_REST_UPPER
      ]);
      this.addTrack(tr, "rightLowerArm", [0, 0.28, 1.6, 2.2], [
        R_REST_LOWER, e(0.42, 0.16, -2.15), e(0.42, 0.16, -2.15), R_REST_LOWER
      ]);
      this.addTrack(tr, "leftUpperArm", [0, 0.28, 1.6, 2.2], [L_REST_UPPER, L_REST_UPPER, L_REST_UPPER, L_REST_UPPER]);
      this.addTrack(tr, "leftLowerArm", [0, 0.28, 1.6, 2.2], [L_REST_LOWER, L_REST_LOWER, L_REST_LOWER, L_REST_LOWER]);
      this.gestureClips.set("giggle", new THREE.AnimationClip("md-giggle", 2.2, tr));
    }

    // 13. Proud: Confident stance, both hands on hips (akimbo), chest expanded, chin lifted
    {
      const t = [0, 0.35, 0.5, 1.8, 2.4];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "hips", [0, 0.35, 1.8, 2.4], [ZERO, e(-0.03, 0, 0), e(-0.03, 0, 0), ZERO]);
      this.addTrack(tr, "chest", [0, 0.35, 1.8, 2.4], [ZERO, e(-0.08, 0, 0), e(-0.08, 0, 0), ZERO]);
      this.addTrack(tr, "neck", [0, 0.35, 1.8, 2.4], [ZERO, e(-0.08, 0, 0), e(-0.08, 0, 0), ZERO]);
      this.addTrack(tr, "rightShoulder", [0, 0.35, 1.8, 2.4], [ZERO, e(0, 0, -0.08), e(0, 0, -0.08), ZERO]);
      this.addTrack(tr, "leftShoulder", [0, 0.35, 1.8, 2.4], [ZERO, e(0, 0, 0.08), e(0, 0, 0.08), ZERO]);
      this.addTrack(tr, "rightUpperArm", t, [
        R_REST_UPPER, e(0.35, 0.15, 0.65), e(0.32, 0.12, 0.68), e(0.32, 0.12, 0.68), R_REST_UPPER
      ]);
      this.addTrack(tr, "leftUpperArm", t, [
        L_REST_UPPER, e(0.35, -0.15, -0.65), e(0.32, -0.12, -0.68), e(0.32, -0.12, -0.68), L_REST_UPPER
      ]);
      this.addTrack(tr, "rightLowerArm", t, [
        R_REST_LOWER, e(0.38, 0.10, -1.25), e(0.35, 0.08, -1.18), e(0.35, 0.08, -1.18), R_REST_LOWER
      ]);
      this.addTrack(tr, "leftLowerArm", t, [
        L_REST_LOWER, e(0.38, -0.10, 1.25), e(0.35, -0.08, 1.18), e(0.35, -0.08, 1.18), L_REST_LOWER
      ]);
      this.gestureClips.set("proud", new THREE.AnimationClip("md-proud", 2.4, tr));
    }
  }
}
