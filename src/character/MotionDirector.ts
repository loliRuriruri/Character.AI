import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { GestureName } from "../shared/types";
import { MOTION_CONFIG } from "./motionConfig";
import { motionEventBus, type MotionEvent, type MotionIntentData } from "./motionEventBus";
import { loadMixamoAnimation } from "./loadMixamoAnimation";

export type ConvState = "idle" | "listening" | "thinking" | "speaking" | "afterglow";

const GESTURE_MAX_DURATION = 2.2; // Rule 5: 2.2s conversational gesture length limit
const GESTURE_START_OFFSETS: Record<string, number> = {
  nod: 0.15,     // 0.15s dead pause skip -> immediate 1x nod
  wave: 1.10,    // 1.10s rest pause skip -> immediate right hand wave elevation
  explain: 0.40, // 0.40s rest pause skip -> immediate forward hand gesturing
  laugh: 0.80,   // 0.80s rest pause skip -> immediate chuckling & head dip
  think: 0.30,   // 0.30s rest pause skip -> immediate hand to chin rise
};

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

  // Gesture repetition prevention & Cooldown system (Work Order: same 8s, global 2.5s)
  private recentHistory: GestureName[] = [];
  private gestureCooldowns: Map<GestureName, number> = new Map();
  private globalCooldown = 0;

  // Diagnostics & Debug Controls (Work Order Section 4, 16)
  public proceduralEnabled = true;
  public knownGoodVrmaOnly = false;

  // Humanoid bone cache
  private bones: Record<string, THREE.Object3D | null> = {};

  // Procedural timers & targets
  private totalTime = 0;
  private leftWristTarget = new THREE.Quaternion();
  private rightWristTarget = new THREE.Quaternion();

  constructor(vrm: VRM, idleClip: THREE.AnimationClip | null) {
    this.vrm = vrm;
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.cacheBones();
    this.buildFullBodyClips();

    // Setup Layer 1: Base Idle (Always active at weight 1.0)
    if (idleClip) {
      this.idleAction = this.mixer.clipAction(idleClip);
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
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }
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

    for (const n of names) {
      this.bones[n] = humanoid.getNormalizedBoneNode(n as any);
    }
  }

  // Decoupled MotionEventBus Handler
  private handleMotionEvent(event: MotionEvent): void {
    switch (event.type) {
      case "user:submit":
        this.setConversationState("listening");
        break;
      case "llm:firstToken":
        this.setConversationState("speaking");
        // Latency Fallback: immediately trigger speech gesture if idle
        if (this.currentGesture === "idle") {
          this.play("explain", true);
        }
        break;
      case "llm:intent":
        this.applyIntent(event.payload);
        break;
      case "tts:start":
        this.setSpeaking(true);
        break;
      case "tts:end":
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
      if (this.currentGesture === "idle") {
        this.play("explain", true);
      }
    } else {
      // Audio finished: transition to afterglow (1.5s countdown before idle)
      this.setConversationState("afterglow");
      this.returnToIdle(0.4);
    }
  }

  /**
   * Play gesture layered over Base Idle:
   * Base Idle is ALWAYS maintained at weight 1.0 in the mixer background,
   * completely preventing any T-pose drops or momentary bind-pose flashes!
   */
  play(name: GestureName, fromIntent: boolean = false): void {
    if (this.knownGoodVrmaOnly || name === "idle") {
      this.returnToIdle(0.4);
      return;
    }

    // Cooldown & Repetition Filter (Work Order: same 8.0s, global 2.5s)
    if (this.globalCooldown > 0) {
      // Allow turn start from idle (e.g. latency fallback) or initial intent override within 0.8s
      const isTurnStart = fromIntent && (this.currentGesture === "idle" || (this.gestureTime < 0.8 && this.currentGesture === "explain"));
      if (!isTurnStart) {
        return;
      }
    }
    const cd = this.gestureCooldowns.get(name) ?? 0;
    if (cd > 0) {
      if (fromIntent) {
        // Fallback / intent alternative: pick an available conversational gesture
        const alternatives: GestureName[] = ["nod", "think", "explain"];
        const alt = alternatives.find((a) => (this.gestureCooldowns.get(a) ?? 0) <= 0);
        if (alt) {
          name = alt;
        } else {
          return;
        }
      } else {
        return;
      }
    }

    const targetAction = this.gestureActions.get(name);
    const clip = this.gestureClips.get(name);
    if (!targetAction || !clip) return;

    // Cross-fade out previous gesture if still active (NEVER action.stop()!)
    if (this.currentAction) {
      if (this.currentAction !== targetAction) {
        this.currentAction.fadeOut(0.3);
      } else {
        // Same gesture re-triggered while running: reset immediately
        this.currentAction.reset();
      }
    }

    this.currentGesture = name;
    this.gestureTime = 0;
    const startOffset = GESTURE_START_OFFSETS[name] ?? 0;
    this.gestureDuration = Math.min(clip.duration - startOffset, GESTURE_MAX_DURATION);
    this.isCrossFadingOut = false;

    // Record history & Set cooldowns (8.0s same gesture, 2.5s global)
    this.recentHistory.push(name);
    if (this.recentHistory.length > 5) this.recentHistory.shift();
    this.gestureCooldowns.set(name, 8.0);
    this.globalCooldown = 2.5;

    // Ensure Base Idle is always active so model never defaults to T-pose
    if (this.idleAction) {
      this.idleAction.setEffectiveWeight(1.0);
      this.idleAction.play();
    }

    // BUG 2 FIX: Always call reset() to unpause clampWhenFinished actions
    targetAction.reset();
    targetAction.paused = false;
    targetAction.enabled = true;
    targetAction.setEffectiveTimeScale(1.0);
    targetAction.setLoop(THREE.LoopOnce, 1);
    targetAction.clampWhenFinished = true; // Rule 5: LoopOnce + clampWhenFinished = true

    // BUG 1 VERIFIED: Direct local clip time assignment (NEVER action.startAt!)
    targetAction.time = startOffset;

    // Clean fade-in from 0 to 1
    targetAction.setEffectiveWeight(0);
    targetAction.fadeIn(0.3).play();
    this.currentAction = targetAction;
  }

  private returnToIdle(duration: number = 0.4): void {
    if (this.currentAction) {
      if (this.idleAction) {
        this.currentAction.crossFadeTo(this.idleAction, duration, false);
      } else {
        this.currentAction.fadeOut(duration);
      }
      this.currentAction = null;
    }
    this.currentGesture = "idle";
    if (this.idleAction) {
      this.idleAction.setEffectiveWeight(1.0);
      this.idleAction.fadeIn(duration);
      this.idleAction.play();
    }
  }

  /**
   * Asynchronously load and retarget the 5 Mixamo FBX gesture clips at runtime
   * Enforces hips.position removal, VRM 0.0 sign inversion, and clip caching.
   */
  async loadGestureClips(_loader?: any): Promise<void> {
    const list: { name: GestureName; file: string }[] = [
      { name: "nod", file: "./vrma/mixamo/nod.fbx" },
      { name: "wave", file: "./vrma/mixamo/wave.fbx" },
      { name: "explain", file: "./vrma/mixamo/explain.fbx" },
      { name: "laugh", file: "./vrma/mixamo/laugh.fbx" },
      { name: "think", file: "./vrma/mixamo/think.fbx" },
    ];

    for (const item of list) {
      try {
        const cleanClip = await loadMixamoAnimation(item.file, this.vrm, item.name);
        this.gestureClips.set(item.name, cleanClip);

        const act = this.mixer.clipAction(cleanClip);
        act.setLoop(THREE.LoopOnce, 1);
        act.clampWhenFinished = true; // Rule 5: clampWhenFinished = true
        this.gestureActions.set(item.name, act);
        console.log(
          `[MotionDirector] Registered retargeted Mixamo gesture for '${item.name}': duration ${cleanClip.duration.toFixed(2)}s, tracks: ${cleanClip.tracks.length}`
        );
      } catch (err) {
        console.warn(`[MotionDirector] Failed to retarget Mixamo ${item.name}:`, err);
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
   * V2 Canonical Procedural Dynamics:
   * 1. Respiration: 0.25Hz, chest/upperChest 1.5°, spine 0.5°, shoulder phase delay
   * 2. Head Drift: 0.08Hz smooth multi-harmonic noise, neck/head sum <= 3.0°
   * 3. State Transition Micro-Motions: 0.3 ~ 0.6s subtle head tilt / nod / lean
   * Recalculated afresh every frame from absolute phase; zero runaway accumulation!
   */
  private applyProceduralV2(_delta: number): void {
    const t = this.totalTime;

    // 1. Respiration (0.25Hz = 4.0s period)
    const respPhase = t * 2 * Math.PI * 0.25;
    const breathChest = Math.sin(respPhase) * (1.5 * Math.PI / 180);   // 1.5° on X
    const breathSpine = Math.sin(respPhase) * (0.5 * Math.PI / 180);   // 0.5° on X
    const breathShoulder = Math.sin(respPhase - 0.4) * (0.35 * Math.PI / 180); // phase-delayed shoulder lift

    const chest = this.bones["chest"];
    if (chest) {
      chest.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(breathChest * 0.7, 0, 0)));
      chest.quaternion.normalize();
    }
    const upperChest = this.bones["upperChest"];
    if (upperChest) {
      upperChest.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(breathChest * 0.3, 0, 0)));
      upperChest.quaternion.normalize();
    }
    const spine = this.bones["spine"];
    if (spine) {
      spine.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(breathSpine, 0, 0)));
      spine.quaternion.normalize();
    }
    const leftShoulder = this.bones["leftShoulder"];
    if (leftShoulder) {
      leftShoulder.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, breathShoulder)));
      leftShoulder.quaternion.normalize();
    }
    const rightShoulder = this.bones["rightShoulder"];
    if (rightShoulder) {
      rightShoulder.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -breathShoulder)));
      rightShoulder.quaternion.normalize();
    }

    // 2. Head Drift (0.08Hz = 12.5s period)
    const driftPhase = t * 2 * Math.PI * 0.08;
    const rawPitch = Math.sin(driftPhase * 0.9) * 0.016 + Math.cos(driftPhase * 0.4) * 0.008;
    const rawYaw = Math.cos(driftPhase * 0.7) * 0.018 + Math.sin(driftPhase * 0.3) * 0.009;
    const rawRoll = Math.sin(driftPhase * 0.5) * 0.008;

    // Strict clamp: neck + head total <= 3° (0.0523 rad)
    const MAX_DRIFT = 3.0 * Math.PI / 180;
    const driftPitch = THREE.MathUtils.clamp(rawPitch, -MAX_DRIFT, MAX_DRIFT);
    const driftYaw = THREE.MathUtils.clamp(rawYaw, -MAX_DRIFT, MAX_DRIFT);
    const driftRoll = THREE.MathUtils.clamp(rawRoll, -MAX_DRIFT, MAX_DRIFT);

    // Distribute 40% to neck, 60% to head
    const neck = this.bones["neck"];
    if (neck) {
      neck.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(driftPitch * 0.4, driftYaw * 0.4, driftRoll * 0.4)));
      neck.quaternion.normalize();
    }
    const head = this.bones["head"];
    if (head) {
      head.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(driftPitch * 0.6, driftYaw * 0.6, driftRoll * 0.6)));
      head.quaternion.normalize();
    }

    // 3. State Transition Micro-Motions (0.3 ~ 0.6s)
    if (this.transitionMotionProgress < 1.0 && this.transitionMotionType) {
      const bell = Math.sin(this.transitionMotionProgress * Math.PI);
      switch (this.transitionMotionType) {
        case "listening": {
          // Eye shift + micro head tilt (0.03 rad on Z)
          if (head) {
            head.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, bell * 0.03)));
            head.quaternion.normalize();
          }
          break;
        }
        case "thinking": {
          // Gaze away + micro lean (chest 0.015 rad, neck pitch 0.025 rad)
          if (chest) {
            chest.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-bell * 0.015, 0, 0)));
            chest.quaternion.normalize();
          }
          if (neck) {
            neck.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(bell * 0.025, bell * 0.02, 0)));
            neck.quaternion.normalize();
          }
          break;
        }
        case "speaking": {
          // Light 1x nod on neck/head X (0.045 rad)
          if (neck) {
            neck.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(bell * 0.025, 0, 0)));
            neck.quaternion.normalize();
          }
          if (head) {
            head.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(bell * 0.02, 0, 0)));
            head.quaternion.normalize();
          }
          break;
        }
        case "afterglow": {
          // Subtle shoulder relaxation
          if (spine) {
            spine.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(bell * 0.01, 0, 0)));
            spine.quaternion.normalize();
          }
          break;
        }
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
