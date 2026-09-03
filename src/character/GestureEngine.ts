import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { GestureName } from "../shared/types";

export class GestureEngine {
  private vrm: VRM;
  readonly mixer: THREE.AnimationMixer;
  private idleAction: THREE.AnimationAction | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private currentGesture: GestureName = "idle";
  private gestureTime = 0;
  private gestureDuration = 2.0;
  private totalTime = 0;

  private isSpeaking = false;
  private speechTimer = 0;
  private speechIndex = 0;
  private readonly speechGestures: GestureName[] = ["talk", "nod", "curious", "giggle", "sing", "cheer"];

  // Humanoid bone cache
  private bones: Record<string, THREE.Object3D | null> = {};

  // Gesture clips & actions for upper body kinematics
  private gestureClips: Map<GestureName, THREE.AnimationClip> = new Map();
  private gestureActions: Map<GestureName, THREE.AnimationAction> = new Map();

  // Wrist target orientations for continuous smooth spline driving
  private leftWristTarget = new THREE.Quaternion();
  private rightWristTarget = new THREE.Quaternion();

  constructor(vrm: VRM, idleClip: THREE.AnimationClip | null) {
    this.vrm = vrm;
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.cacheBones();
    this.buildClips();

    // 1. Setup Idle Action from VRMA mocap or procedural fallback
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
      this.currentAction = null;
    }

    // 2. Setup Gesture Actions (CRITICAL: clampWhenFinished MUST be false so motion seamlessly blends to idle!)
    for (const [name, clip] of this.gestureClips.entries()) {
      if (name === "idle") continue;
      const act = this.mixer.clipAction(clip);
      act.setLoop(THREE.LoopOnce, 1);
      act.clampWhenFinished = false;
      this.gestureActions.set(name, act);
    }

    // 3. Auxiliary finished event listener
    this.mixer.addEventListener("finished", (e: any) => {
      if (this.currentAction && e.action === this.currentAction) {
        this.stopCurrentGesture();
      }
    });
  }

  private stopCurrentGesture(): void {
    if (this.currentAction) {
      this.currentAction.fadeOut(0.28);
      this.currentAction = null;
    }
    this.currentGesture = "idle";
    if (this.idleAction) {
      this.idleAction.setEffectiveWeight(1.0);
      this.idleAction.play();
    }
  }

  private cacheBones(): void {
    const humanoid = this.vrm.humanoid;
    if (!humanoid) return;

    const names = [
      "hips", "spine", "chest", "neck", "head",
      "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
      "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
      // Left 15 Finger Joints (3 joints x 5 fingers)
      "leftThumbProximal", "leftThumbIntermediate", "leftThumbDistal",
      "leftIndexProximal", "leftIndexIntermediate", "leftIndexDistal",
      "leftMiddleProximal", "leftMiddleIntermediate", "leftMiddleDistal",
      "leftRingProximal", "leftRingIntermediate", "leftRingDistal",
      "leftLittleProximal", "leftLittleIntermediate", "leftLittleDistal",
      // Right 15 Finger Joints (3 joints x 5 fingers)
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

  setSpeaking(speaking: boolean): void {
    if (this.isSpeaking === speaking) return;
    this.isSpeaking = speaking;

    if (speaking) {
      this.speechTimer = 0;
      this.speechIndex = 0;
      this.play(this.speechGestures[0]);
    } else {
      this.play("nod");
    }
  }

  play(name: GestureName): void {
    if (name === "idle") {
      this.stopCurrentGesture();
      return;
    }

    const targetAction = this.gestureActions.get(name);
    const clip = this.gestureClips.get(name);
    if (!targetAction || !clip) return;

    // Smoothly blend away previous gesture if running
    if (this.currentAction && this.currentAction !== targetAction) {
      this.currentAction.fadeOut(0.18);
    }

    this.currentGesture = name;
    this.gestureTime = 0;
    this.gestureDuration = clip.duration;

    targetAction.reset();
    targetAction.setEffectiveTimeScale(1.0);
    targetAction.setEffectiveWeight(1.0);
    targetAction.setLoop(THREE.LoopOnce, 1);
    targetAction.clampWhenFinished = false;
    targetAction.fadeIn(0.18).play();
    this.currentAction = targetAction;

    if (this.idleAction) {
      this.idleAction.setEffectiveWeight(1.0);
      this.idleAction.play();
    }
  }

  update(delta: number): void {
    this.totalTime += delta;
    this.gestureTime += delta;
    this.mixer.update(delta);

    // 0. Robust Timer-Based Gesture Completion: Never freeze on last frame!
    if (this.currentAction && this.currentGesture !== "idle") {
      if (this.gestureTime >= this.gestureDuration) {
        this.stopCurrentGesture();
      }
    }

    // 1. Dynamic speech body-language cycling
    if (this.isSpeaking) {
      this.speechTimer += delta;
      if (this.speechTimer > 2.6) {
        this.speechTimer = 0;
        this.speechIndex = (this.speechIndex + 1) % this.speechGestures.length;
        this.play(this.speechGestures[this.speechIndex]);
      }
    }

    // 2. Procedural Idle Layer (Core Breathing & Subtle Hip Sway)
    this.applyProceduralIdle(delta);

    // 3. Critically Damped Fluid Wrist Dynamics (Eliminates stiff angular jerkiness!)
    this.applyFluidWrists(delta);

    // 4. Living Cascading Finger Dynamics (30 joints: flutter, spread, inertial follow-through)
    this.applyLivingFingers(delta);
  }

  /** Procedural micro-motion on hips, spine, chest, and neck (Multi-frequency organic breathing) */
  private applyProceduralIdle(_delta: number): void {
    const t = this.totalTime;
    // Multi-frequency natural breathing avoids synthetic mechanical repetition
    const breath = Math.sin(t * 1.4) * 0.012 + Math.sin(t * 2.2) * 0.003;
    const hipSway = Math.sin(t * 0.7) * 0.009;
    const neckBreath = Math.sin(t * 1.4 - 0.2) * 0.005;

    const chest = this.bones["chest"];
    if (chest) {
      chest.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(breath, 0, 0)));
    }

    const neck = this.bones["neck"];
    if (neck) {
      neck.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(neckBreath, 0, 0)));
    }

    const hips = this.bones["hips"];
    if (hips) {
      hips.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, hipSway, 0)));
    }
  }

  /** Smooth, continuous 60fps trigonometric wrist trajectory with zero angular corners */
  private applyFluidWrists(delta: number): void {
    const t = this.totalTime;
    const gt = this.gestureTime;
    const lerpSpeed = Math.min(1, delta * 12.0);

    // Default rest poses from VRM 0.0 normalized coordinates
    const L_REST_EULER = new THREE.Euler(0.32, -0.03, -0.01);
    const R_REST_EULER = new THREE.Euler(0.28, 0.04, 0.03);

    let lEuler = L_REST_EULER.clone();
    let rEuler = R_REST_EULER.clone();

    // Breathing micro-sway in wrists
    const wristBreath = Math.sin(t * 1.5) * 0.02;
    lEuler.x += wristBreath;
    rEuler.x += wristBreath;

    if (this.currentGesture === "wave") {
      // Fluid sinusoidal oscillation: continuous smooth curve with acceleration & deceleration
      const waveAngle = Math.sin(gt * 7.5) * 0.42;
      rEuler.set(0.22, 0.15, waveAngle);
    } else if (this.currentGesture === "talk") {
      // Conversational wrist cadence with flexion & pronation
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
      // Modest forward clasped wrists
      rEuler.set(0.18, 0.06, -0.06);
      lEuler.set(0.18, -0.06, 0.06);
    } else if (this.currentGesture === "curious") {
      // Questioning open hand
      rEuler.set(0.26, 0.16, 0.14);
      lEuler.set(0.22, -0.08, 0.05);
    } else if (this.currentGesture === "giggle") {
      // Hand covering mouth with subtle flutter
      const giggleFlutter = Math.sin(gt * 12.0) * 0.03;
      rEuler.set(0.42 + giggleFlutter, 0.24, 0.32);
    } else if (this.currentGesture === "proud") {
      // Hands on waist / akimbo resting pose
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

  /**
   * 30-Joint Living Cascading Finger Dynamics
   * 3-joint cascade: Proximal -> Intermediate (1.2x) -> Distal (0.8x)
   * Micro-flutter breathing wave, conversational speech expansion, and inertial wave follow-through
   */
  private applyLivingFingers(delta: number): void {
    const t = this.totalTime;
    const gt = this.gestureTime;
    const isPeace = this.currentGesture === "peace";
    const isWave = this.currentGesture === "wave";
    const isGiggle = this.currentGesture === "giggle";
    const isBow = this.currentGesture === "bow";
    const isProud = this.currentGesture === "proud";
    const lerpSpeed = Math.min(1, delta * 12.0);

    // 1. Base Finger Definitions with anatomical spreads
    const fingers = [
      { name: "Index", baseCurl: 0.32, spread: 0.05, idx: 1 },
      { name: "Middle", baseCurl: 0.35, spread: 0.00, idx: 2 },
      { name: "Ring", baseCurl: 0.38, spread: -0.04, idx: 3 },
      { name: "Little", baseCurl: 0.42, spread: -0.08, idx: 4 },
    ];

    // Speech opening impulse: opens palm on vowels/rhythm
    const speechPulse = this.isSpeaking ? (Math.sin(t * 3.0) * 0.5 + 0.5) * 0.16 : 0;

    // Wave secondary inertia: fingertips lag behind the wrist oscillation
    const waveInertiaLag = isWave ? Math.sin(gt * 7.5 - 0.45) * 0.22 : 0;

    for (const f of fingers) {
      // Dynamic breathing flutter: each finger ripples with a 0.25s phase shift
      const flutter = Math.sin(t * 1.6 + f.idx * 0.35) * 0.035;

      let curlL = f.baseCurl + flutter - speechPulse;
      let curlR = f.baseCurl + flutter - speechPulse;

      if (isWave) {
        curlR += waveInertiaLag;
      }

      if (isPeace) {
        // V-sign: Index & Middle are straight; Ring & Little are curled into palm
        if (f.name === "Index" || f.name === "Middle") {
          curlR = 0.03;
        } else {
          curlR = 0.95;
        }
      } else if (isGiggle) {
        // Soft cupped fingers over mouth
        curlR = 0.55 + Math.sin(gt * 10.0 + f.idx * 0.2) * 0.04;
      } else if (isBow) {
        // Clean extended straight fingers along thigh
        curlL = 0.18;
        curlR = 0.18;
      } else if (isProud) {
        // Slightly curled resting fingers on hips
        curlL = 0.48;
        curlR = 0.48;
      }

      // Drive Left 3-joint chain (Proximal, Intermediate, Distal)
      const lP = this.bones[`left${f.name}Proximal`];
      const lI = this.bones[`left${f.name}Intermediate`];
      const lD = this.bones[`left${f.name}Distal`];

      if (lP) lP.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, f.spread, curlL)), lerpSpeed);
      if (lI) lI.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, curlL * 1.2)), lerpSpeed);
      if (lD) lD.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, curlL * 0.8)), lerpSpeed);

      // Drive Right 3-joint chain (Symmetric negative Z curl)
      const rP = this.bones[`right${f.name}Proximal`];
      const rI = this.bones[`right${f.name}Intermediate`];
      const rD = this.bones[`right${f.name}Distal`];

      if (rP) rP.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -f.spread, -curlR)), lerpSpeed);
      if (rI) rI.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -curlR * 1.2)), lerpSpeed);
      if (rD) rD.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -curlR * 0.8)), lerpSpeed);
    }

    // 2. Anatomical 3-Joint Thumbs (Proximal, Intermediate, Distal)
    let thumbFoldL = 0.28 + Math.sin(t * 1.5) * 0.03;
    let thumbFoldR = 0.28 + Math.sin(t * 1.5) * 0.03;

    if (isPeace) {
      // Thumb wraps securely over ring finger for tight V-sign
      thumbFoldR = 0.55;
    } else if (isProud) {
      thumbFoldL = 0.45;
      thumbFoldR = 0.45;
    }

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

  private buildClips(): void {
    const e = (x: number, y: number, z: number) => new THREE.Euler(x, y, z);

    // Natural rest values for hanging arms:
    const L_REST_UPPER = e(0, 0, 1.32);
    const R_REST_UPPER = e(0, 0, -1.32);
    const L_REST_LOWER = e(0.12, -0.08, 0.15);
    const R_REST_LOWER = e(0.12, 0.08, -0.15);
    const ZERO = e(0, 0, 0);

    // 1. Procedural Idle fallback (Breathing + subtle upper arm sway)
    {
      const t = [0, 1.8, 3.6];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "chest", t, [ZERO, e(0.02, 0, 0), ZERO]);
      this.addTrack(tr, "neck", t, [ZERO, e(0.01, 0, 0), ZERO]);
      this.addTrack(tr, "leftUpperArm", t, [L_REST_UPPER, e(0.04, -0.02, 1.30), L_REST_UPPER]);
      this.addTrack(tr, "rightUpperArm", t, [R_REST_UPPER, e(0.04, 0.02, -1.30), R_REST_UPPER]);
      this.addTrack(tr, "leftLowerArm", t, [L_REST_LOWER, e(0.14, -0.08, 0.18), L_REST_LOWER]);
      this.addTrack(tr, "rightLowerArm", t, [R_REST_LOWER, e(0.14, 0.08, -0.18), R_REST_LOWER]);
      this.gestureClips.set("idle", new THREE.AnimationClip("mc-idle", 3.6, tr));
    }

    // 2. Wave: Right arm lifts high with shoulder elevation, overshoot settling, and cute head tilt
    {
      // 0 -> Anticipation (0.2s) -> Overshoot peak (0.45s) -> Settled waving (1.0 - 2.0s) -> Cushion return (2.8s)
      const t = [0, 0.2, 0.45, 1.0, 1.5, 2.0, 2.4, 2.8];
      const tr: THREE.KeyframeTrack[] = [];
      // Clavicle / Shoulder Elevation: Crucial to prevent arm detachment!
      this.addTrack(tr, "rightShoulder", [0, 0.2, 0.45, 2.0, 2.8], [
        ZERO, e(0, 0, -0.08), e(0, 0, -0.18), e(0, 0, -0.18), ZERO
      ]);
      // Upper arm: Anticipates downwards slightly, shoots over 0.75, settles at 0.65
      this.addTrack(tr, "rightUpperArm", t, [
        R_REST_UPPER,
        e(-0.05, 0.05, -1.25),
        e(0.74, 0.38, 0.16),
        e(0.66, 0.34, 0.10),
        e(0.64, 0.36, 0.12),
        e(0.66, 0.34, 0.10),
        e(0.25, 0.15, -0.65),
        R_REST_UPPER
      ]);
      // Lower arm elbow 90 deg waving
      this.addTrack(tr, "rightLowerArm", t, [
        R_REST_LOWER,
        e(0.18, 0.08, -0.22),
        e(0.48, 0.24, -1.68),
        e(0.42, 0.20, -1.55),
        e(0.40, 0.22, -1.52),
        e(0.42, 0.20, -1.55),
        e(0.28, 0.12, -0.75),
        R_REST_LOWER
      ]);
      // Head tilt towards user with gentle counter-sway
      this.addTrack(tr, "neck", [0, 0.45, 1.2, 2.0, 2.8], [
        ZERO, e(0.02, 0.04, 0.10), e(0.01, 0.03, 0.12), e(0.02, 0.04, 0.10), ZERO
      ]);
      this.addTrack(tr, "chest", [0, 0.45, 2.0, 2.8], [
        ZERO, e(0.03, -0.06, -0.03), e(0.03, -0.06, -0.03), ZERO
      ]);
      this.gestureClips.set("wave", new THREE.AnimationClip("mc-wave", 2.8, tr));
    }

    // 3. Talk: Conversational asymmetrical arm cadence with flexed elbows and chest breathing
    {
      const t = [0, 0.35, 0.8, 1.3, 1.8, 2.3];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "rightShoulder", [0, 0.35, 1.8, 2.3], [ZERO, e(0, 0, -0.06), e(0, 0, -0.06), ZERO]);
      this.addTrack(tr, "rightUpperArm", t, [
        R_REST_UPPER, e(0.42, 0.20, -0.70), e(0.28, 0.12, -0.52), e(0.45, 0.24, -0.75), e(0.32, 0.16, -0.58), R_REST_UPPER
      ]);
      this.addTrack(tr, "rightLowerArm", t, [
        R_REST_LOWER, e(0.42, 0.24, -0.98), e(0.24, 0.15, -0.58), e(0.44, 0.26, -1.02), e(0.28, 0.18, -0.68), R_REST_LOWER
      ]);
      this.addTrack(tr, "leftUpperArm", t, [
        L_REST_UPPER, e(0.18, -0.12, 1.15), e(0.26, -0.16, 1.08), e(0.20, -0.12, 1.14), e(0.24, -0.15, 1.10), L_REST_UPPER
      ]);
      this.addTrack(tr, "leftLowerArm", t, [
        L_REST_LOWER, e(0.22, -0.10, 0.45), e(0.30, -0.14, 0.58), e(0.22, -0.10, 0.45), e(0.28, -0.12, 0.52), L_REST_LOWER
      ]);
      this.addTrack(tr, "neck", [0, 0.4, 0.9, 1.4, 1.9, 2.3], [
        ZERO, e(0.04, 0.02, 0.02), e(-0.02, -0.02, -0.01), e(0.05, 0.02, 0.02), e(-0.01, 0, 0), ZERO
      ]);
      this.addTrack(tr, "chest", t, [
        ZERO, e(0.05, 0.03, 0), e(0.02, -0.01, 0), e(0.05, 0.03, 0), e(0.02, -0.01, 0), ZERO
      ]);
      this.gestureClips.set("talk", new THREE.AnimationClip("mc-talk", 2.3, tr));
    }

    // 4. Peace: High V sign arm pose with shoulder elevation, playful head tilt, and overshoot
    {
      const t = [0, 0.32, 0.5, 1.8, 2.4];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "rightShoulder", [0, 0.32, 1.8, 2.4], [ZERO, e(0, 0, -0.15), e(0, 0, -0.15), ZERO]);
      this.addTrack(tr, "rightUpperArm", t, [
        R_REST_UPPER, e(0.78, 0.42, -0.08), e(0.72, 0.38, -0.12), e(0.72, 0.38, -0.12), R_REST_UPPER
      ]);
      this.addTrack(tr, "rightLowerArm", t, [
        R_REST_LOWER, e(0.40, 0.22, -1.95), e(0.35, 0.18, -1.82), e(0.35, 0.18, -1.82), R_REST_LOWER
      ]);
      // Playful head tilt with wink posture
      this.addTrack(tr, "neck", [0, 0.4, 1.8, 2.4], [ZERO, e(0.03, -0.04, -0.14), e(0.03, -0.04, -0.14), ZERO]);
      this.addTrack(tr, "chest", [0, 0.4, 1.8, 2.4], [ZERO, e(0.04, 0.05, 0.02), e(0.04, 0.05, 0.02), ZERO]);
      this.gestureClips.set("peace", new THREE.AnimationClip("mc-peace", 2.4, tr));
    }

    // 5. Cheer: Double arm celebration with energetic double bounce
    {
      const t = [0, 0.35, 0.7, 1.1, 1.5, 1.9, 2.4];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "rightShoulder", [0, 0.35, 1.9, 2.4], [ZERO, e(0, 0, -0.18), e(0, 0, -0.18), ZERO]);
      this.addTrack(tr, "leftShoulder", [0, 0.35, 1.9, 2.4], [ZERO, e(0, 0, 0.18), e(0, 0, 0.18), ZERO]);
      this.addTrack(tr, "rightUpperArm", t, [
        R_REST_UPPER,
        e(0.82, 0.28, -0.42), e(0.74, 0.24, -0.48), e(0.84, 0.30, -0.42), e(0.74, 0.24, -0.48), e(0.80, 0.28, -0.44),
        R_REST_UPPER
      ]);
      this.addTrack(tr, "leftUpperArm", t, [
        L_REST_UPPER,
        e(0.82, -0.28, 0.42), e(0.74, -0.24, 0.48), e(0.84, -0.30, 0.42), e(0.74, -0.24, 0.48), e(0.80, -0.28, 0.44),
        L_REST_UPPER
      ]);
      this.addTrack(tr, "rightLowerArm", t, [
        R_REST_LOWER,
        e(0.52, 0.22, -1.18), e(0.42, 0.16, -1.02), e(0.54, 0.24, -1.20), e(0.42, 0.16, -1.02), e(0.50, 0.20, -1.15),
        R_REST_LOWER
      ]);
      this.addTrack(tr, "leftLowerArm", t, [
        L_REST_LOWER,
        e(0.52, -0.22, 1.18), e(0.42, -0.16, 1.02), e(0.54, -0.24, 1.20), e(0.42, -0.16, 1.02), e(0.50, -0.20, 1.15),
        L_REST_LOWER
      ]);
      // Joyous upward chest expansion & bouncing
      this.addTrack(tr, "chest", t, [
        ZERO, e(0.08, 0, 0), e(0.04, 0, 0), e(0.09, 0, 0), e(0.04, 0, 0), e(0.07, 0, 0), ZERO
      ]);
      this.addTrack(tr, "neck", [0, 0.35, 1.1, 1.9, 2.4], [
        ZERO, e(-0.06, 0, 0), e(-0.04, 0, 0), e(-0.06, 0, 0), ZERO
      ]);
      this.gestureClips.set("cheer", new THREE.AnimationClip("mc-cheer", 2.4, tr));
    }

    // 6. Thinking: Right hand to chin with thoughtful head tilt
    {
      const t = [0, 0.45, 1.2, 2.0, 2.6];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "rightShoulder", [0, 0.45, 2.0, 2.6], [ZERO, e(0, 0, -0.08), e(0, 0, -0.08), ZERO]);
      this.addTrack(tr, "rightUpperArm", t, [
        R_REST_UPPER, e(0.85, 0.30, -0.25), e(0.82, 0.28, -0.28), e(0.84, 0.29, -0.26), R_REST_UPPER
      ]);
      this.addTrack(tr, "rightLowerArm", t, [
        R_REST_LOWER, e(0.38, 0.15, -2.02), e(0.35, 0.12, -1.95), e(0.36, 0.14, -1.98), R_REST_LOWER
      ]);
      this.addTrack(tr, "leftUpperArm", t, [
        L_REST_UPPER, e(0.32, -0.22, 0.88), e(0.30, -0.20, 0.85), e(0.30, -0.20, 0.85), L_REST_UPPER
      ]);
      this.addTrack(tr, "leftLowerArm", t, [
        L_REST_LOWER, e(0.28, -0.18, 0.88), e(0.25, -0.15, 0.85), e(0.25, -0.15, 0.85), L_REST_LOWER
      ]);
      // Inquisitive head tilt to right side
      this.addTrack(tr, "neck", [0, 0.45, 2.0, 2.6], [
        ZERO, e(0.04, -0.06, -0.15), e(0.04, -0.06, -0.15), ZERO
      ]);
      this.addTrack(tr, "chest", [0, 0.45, 2.0, 2.6], [
        ZERO, e(0.04, -0.05, 0.03), e(0.04, -0.05, 0.03), ZERO
      ]);
      this.gestureClips.set("thinking", new THREE.AnimationClip("mc-thinking", 2.6, tr));
    }

    // 7. Shy: Modest clasped arms with gentle lowered head
    {
      const t = [0, 0.45, 1.9, 2.5];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "rightUpperArm", t, [R_REST_UPPER, e(0.35, 0.18, -0.92), e(0.35, 0.18, -0.92), R_REST_UPPER]);
      this.addTrack(tr, "leftUpperArm", t, [L_REST_UPPER, e(0.35, -0.18, 0.92), e(0.35, -0.18, 0.92), L_REST_UPPER]);
      this.addTrack(tr, "rightLowerArm", t, [R_REST_LOWER, e(0.38, 0.05, -0.95), e(0.38, 0.05, -0.95), R_REST_LOWER]);
      this.addTrack(tr, "leftLowerArm", t, [L_REST_LOWER, e(0.38, -0.05, 0.95), e(0.38, -0.05, 0.95), L_REST_LOWER]);
      this.addTrack(tr, "neck", [0, 0.45, 1.9, 2.5], [ZERO, e(0.08, 0.02, 0.06), e(0.08, 0.02, 0.06), ZERO]);
      this.addTrack(tr, "chest", t, [ZERO, e(-0.05, 0, 0), e(-0.05, 0, 0), ZERO]);
      this.gestureClips.set("shy", new THREE.AnimationClip("mc-shy", 2.5, tr));
    }

    // 8. Sing: Idol singing with rhythmic arm bounce and chest posture
    {
      const t = [0, 0.45, 1.0, 1.5, 2.0, 2.5];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "rightShoulder", [0, 0.45, 2.0, 2.5], [ZERO, e(0, 0, -0.10), e(0, 0, -0.10), ZERO]);
      this.addTrack(tr, "rightUpperArm", t, [
        R_REST_UPPER, e(0.82, 0.34, -0.22), e(0.76, 0.30, -0.25), e(0.82, 0.34, -0.22), e(0.78, 0.32, -0.24), R_REST_UPPER
      ]);
      this.addTrack(tr, "rightLowerArm", t, [
        R_REST_LOWER, e(0.38, 0.18, -1.82), e(0.32, 0.14, -1.72), e(0.38, 0.18, -1.82), e(0.34, 0.16, -1.76), R_REST_LOWER
      ]);
      this.addTrack(tr, "leftUpperArm", t, [
        L_REST_UPPER, e(0.32, -0.22, 0.85), e(0.28, -0.18, 0.92), e(0.32, -0.22, 0.85), e(0.28, -0.18, 0.90), L_REST_UPPER
      ]);
      this.addTrack(tr, "leftLowerArm", t, [
        L_REST_LOWER, e(0.25, -0.15, 0.65), e(0.20, -0.12, 0.58), e(0.25, -0.15, 0.65), e(0.22, -0.14, 0.60), L_REST_LOWER
      ]);
      this.addTrack(tr, "chest", t, [
        ZERO, e(0.06, 0.04, 0.02), e(0.03, -0.02, -0.01), e(0.06, 0.04, 0.02), e(0.04, 0.01, 0), ZERO
      ]);
      this.addTrack(tr, "neck", [0, 0.45, 1.0, 1.5, 2.0, 2.5], [
        ZERO, e(0.03, 0.04, 0.06), e(-0.02, -0.02, -0.04), e(0.03, 0.04, 0.06), e(0, 0, 0), ZERO
      ]);
      this.gestureClips.set("sing", new THREE.AnimationClip("mc-sing", 2.5, tr));
    }

    // 9. Nod: Natural human double-nod (Primary affirmative nod followed by small confirming settle)
    {
      const t = [0, 0.28, 0.50, 0.78, 1.0, 1.35];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "chest", t, [
        ZERO, e(0.14, 0, 0), e(-0.03, 0, 0), e(0.08, 0, 0), e(-0.01, 0, 0), ZERO
      ]);
      this.addTrack(tr, "neck", t, [
        ZERO, e(0.16, 0, 0), e(-0.04, 0, 0), e(0.09, 0, 0), e(-0.02, 0, 0), ZERO
      ]);
      this.gestureClips.set("nod", new THREE.AnimationClip("mc-nod", 1.35, tr));
    }

    // 10. [NEW] Bow: Polite Japanese-style bow with spine/chest/neck alignment and smooth return
    {
      const t = [0, 0.38, 0.9, 1.5, 2.0, 2.5];
      const tr: THREE.KeyframeTrack[] = [];
      // Deep polite 16-degree bow at spine and chest
      this.addTrack(tr, "chest", t, [
        ZERO, e(0.24, 0, 0), e(0.26, 0, 0), e(0.14, 0, 0), e(-0.02, 0, 0), ZERO
      ]);
      this.addTrack(tr, "neck", t, [
        ZERO, e(0.12, 0, 0), e(0.13, 0, 0), e(0.06, 0, 0), e(-0.01, 0, 0), ZERO
      ]);
      // Arms aligned neatly at thighs
      this.addTrack(tr, "rightUpperArm", t, [
        R_REST_UPPER, e(0.15, 0.08, -1.22), e(0.16, 0.08, -1.22), e(0.08, 0.04, -1.28), R_REST_UPPER, R_REST_UPPER
      ]);
      this.addTrack(tr, "leftUpperArm", t, [
        L_REST_UPPER, e(0.15, -0.08, 1.22), e(0.16, -0.08, 1.22), e(0.08, -0.04, 1.28), L_REST_UPPER, L_REST_UPPER
      ]);
      this.addTrack(tr, "rightLowerArm", t, [
        R_REST_LOWER, e(0.08, 0.04, -0.08), e(0.08, 0.04, -0.08), e(0.10, 0.06, -0.12), R_REST_LOWER, R_REST_LOWER
      ]);
      this.addTrack(tr, "leftLowerArm", t, [
        L_REST_LOWER, e(0.08, -0.04, 0.08), e(0.08, -0.04, 0.08), e(0.10, -0.06, 0.12), L_REST_LOWER, L_REST_LOWER
      ]);
      this.gestureClips.set("bow", new THREE.AnimationClip("mc-bow", 2.5, tr));
    }

    // 11. [NEW] Curious: Questioning head tilt, lean forward, open listening posture
    {
      const t = [0, 0.35, 1.5, 2.2];
      const tr: THREE.KeyframeTrack[] = [];
      // Noticeable cute head tilt and lean forward
      this.addTrack(tr, "neck", t, [
        ZERO, e(0.05, 0.08, 0.18), e(0.05, 0.08, 0.18), ZERO
      ]);
      this.addTrack(tr, "chest", t, [
        ZERO, e(0.08, 0.04, 0.02), e(0.08, 0.04, 0.02), ZERO
      ]);
      // Right hand raises slightly with open palm ('Hm?')
      this.addTrack(tr, "rightUpperArm", t, [
        R_REST_UPPER, e(0.38, 0.18, -0.85), e(0.38, 0.18, -0.85), R_REST_UPPER
      ]);
      this.addTrack(tr, "rightLowerArm", t, [
        R_REST_LOWER, e(0.35, 0.14, -0.92), e(0.35, 0.14, -0.92), R_REST_LOWER
      ]);
      this.addTrack(tr, "leftUpperArm", t, [
        L_REST_UPPER, e(0.15, -0.08, 1.25), e(0.15, -0.08, 1.25), L_REST_UPPER
      ]);
      this.gestureClips.set("curious", new THREE.AnimationClip("mc-curious", 2.2, tr));
    }

    // 12. [NEW] Giggle: Hand covers mouth with soft triple laughing bounce
    {
      const t = [0, 0.28, 0.55, 0.82, 1.1, 1.6, 2.2];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "rightShoulder", [0, 0.28, 1.6, 2.2], [ZERO, e(0, 0, -0.12), e(0, 0, -0.12), ZERO]);
      // Right arm lifts to cover mouth
      this.addTrack(tr, "rightUpperArm", [0, 0.28, 1.6, 2.2], [
        R_REST_UPPER, e(0.88, 0.32, -0.12), e(0.88, 0.32, -0.12), R_REST_UPPER
      ]);
      this.addTrack(tr, "rightLowerArm", [0, 0.28, 1.6, 2.2], [
        R_REST_LOWER, e(0.42, 0.16, -2.15), e(0.42, 0.16, -2.15), R_REST_LOWER
      ]);
      // Left arm clasps waist
      this.addTrack(tr, "leftUpperArm", [0, 0.28, 1.6, 2.2], [
        L_REST_UPPER, e(0.25, -0.15, 0.95), e(0.25, -0.15, 0.95), L_REST_UPPER
      ]);
      this.addTrack(tr, "leftLowerArm", [0, 0.28, 1.6, 2.2], [
        L_REST_LOWER, e(0.22, -0.10, 0.75), e(0.22, -0.10, 0.75), L_REST_LOWER
      ]);
      // Triple bounce chuckling in chest
      this.addTrack(tr, "chest", t, [
        ZERO, e(0.06, 0, 0), e(0.02, 0, 0), e(0.07, 0, 0), e(0.02, 0, 0), e(0.05, 0, 0), ZERO
      ]);
      // Head tilts down bashfully
      this.addTrack(tr, "neck", [0, 0.28, 1.6, 2.2], [
        ZERO, e(0.09, 0.04, -0.08), e(0.09, 0.04, -0.08), ZERO
      ]);
      this.gestureClips.set("giggle", new THREE.AnimationClip("mc-giggle", 2.2, tr));
    }

    // 13. [NEW] Proud: Confident stance, hands on hips (akimbo), chest expanded, chin lifted
    {
      const t = [0, 0.35, 0.5, 1.8, 2.4];
      const tr: THREE.KeyframeTrack[] = [];
      this.addTrack(tr, "rightShoulder", [0, 0.35, 1.8, 2.4], [ZERO, e(0, 0, -0.08), e(0, 0, -0.08), ZERO]);
      this.addTrack(tr, "leftShoulder", [0, 0.35, 1.8, 2.4], [ZERO, e(0, 0, 0.08), e(0, 0, 0.08), ZERO]);
      // Both arms akimbo to hips with overshoot
      this.addTrack(tr, "rightUpperArm", t, [
        R_REST_UPPER, e(0.48, 0.22, -0.78), e(0.42, 0.18, -0.82), e(0.42, 0.18, -0.82), R_REST_UPPER
      ]);
      this.addTrack(tr, "leftUpperArm", t, [
        L_REST_UPPER, e(0.48, -0.22, 0.78), e(0.42, -0.18, 0.82), e(0.42, -0.18, 0.82), L_REST_UPPER
      ]);
      this.addTrack(tr, "rightLowerArm", t, [
        R_REST_LOWER, e(0.42, 0.14, -1.25), e(0.38, 0.10, -1.18), e(0.38, 0.10, -1.18), R_REST_LOWER
      ]);
      this.addTrack(tr, "leftLowerArm", t, [
        L_REST_LOWER, e(0.42, -0.14, 1.25), e(0.38, -0.10, 1.18), e(0.38, -0.10, 1.18), L_REST_LOWER
      ]);
      // Chest proudly expanded backwards
      this.addTrack(tr, "chest", [0, 0.35, 1.8, 2.4], [
        ZERO, e(-0.08, 0, 0), e(-0.08, 0, 0), ZERO
      ]);
      // Chin lifted high
      this.addTrack(tr, "neck", [0, 0.35, 1.8, 2.4], [
        ZERO, e(-0.08, 0, 0), e(-0.08, 0, 0), ZERO
      ]);
      this.gestureClips.set("proud", new THREE.AnimationClip("mc-proud", 2.4, tr));
    }
  }
}
