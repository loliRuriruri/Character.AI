import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { MOTION_CONFIG } from "./motionConfig";

/**
 * Advanced Biomimetic Gaze Controller
 * - Saccadic eye darting (1.8 - 3.5s micro-shifts prevent robotic staring)
 * - Thoughtful look-away during LLM deliberation (isThinking)
 * - Conversational speaker gaze cadence (isSpeaking)
 * - Weighted head-blend slerp so LookAt enhances keyframe animations without breaking them
 */
export class LookAtEyes {
  readonly target = new THREE.Object3D();
  private t = 0;
  private readonly headRest = new THREE.Quaternion();
  private readonly neckRest = new THREE.Quaternion();

  // Saccades (micro eye darting)
  private saccadeTimer = 2.0;
  private saccadeOffset = new THREE.Vector3();
  private targetSaccadeOffset = new THREE.Vector3();

  // Cognitive gaze modes
  private isThinking = false;
  private isSpeaking = false;
  private cognitiveOffset = new THREE.Vector3();

  constructor(private readonly vrm: VRM, private readonly camera: THREE.Camera) {
    if (this.vrm.lookAt) this.vrm.lookAt.target = this.target;
  }

  setThinking(thinking: boolean): void {
    this.isThinking = thinking;
  }

  setSpeaking(speaking: boolean): void {
    this.isSpeaking = speaking;
  }

  /** Triggered on blink to naturally relocate gaze focus */
  onBlink(): void {
    this.triggerSaccade(true);
  }

  private triggerSaccade(small: boolean = false): void {
    this.saccadeTimer = 1.6 + Math.random() * 2.2;
    const range = small ? 0.08 : 0.16;
    this.targetSaccadeOffset.set(
      (Math.random() - 0.5) * range * 2,
      (Math.random() - 0.4) * range * 1.2,
      0
    );
  }

  captureHead(): void {
    if (MOTION_CONFIG.MOTION_V2) return; // V2: no head capture needed
    const head = this.vrm.humanoid.getNormalizedBoneNode("head");
    const neck = this.vrm.humanoid.getNormalizedBoneNode("neck");
    if (head) this.headRest.copy(head.quaternion);
    if (neck) this.neckRest.copy(neck.quaternion);
  }

  /**
   * Safe Head & Gaze Blend (Legacy V1 only)
   * Under MOTION_V2, post-update bone manipulation is strictly eliminated.
   */
  restoreHead(): void {
    if (MOTION_CONFIG.MOTION_V2) return; // V2: ZERO post-vrm.update bone modifications!
    const head = this.vrm.humanoid.getNormalizedBoneNode("head");
    const neck = this.vrm.humanoid.getNormalizedBoneNode("neck");
    if (head) head.quaternion.slerp(this.headRest, 0.80);
    if (neck) neck.quaternion.slerp(this.neckRest, 0.80);
  }

  update(delta: number): void {
    this.t += delta;

    // 1. Saccadic micro-darting countdown
    this.saccadeTimer -= delta;
    if (this.saccadeTimer <= 0) {
      this.triggerSaccade();
    }
    this.saccadeOffset.lerp(this.targetSaccadeOffset, Math.min(1.0, delta * 16.0));

    // 2. Cognitive Gaze Modulation
    const targetCognitive = new THREE.Vector3();
    if (this.isThinking) {
      targetCognitive.set(-0.35, 0.38, 0);
    } else if (this.isSpeaking) {
      const speakCycle = Math.sin(this.t * 0.9);
      if (speakCycle > 0.6) {
        targetCognitive.set(0.20, 0.10, 0);
      }
    }
    this.cognitiveOffset.lerp(targetCognitive, Math.min(1.0, delta * 4.0));

    // 3. Composite Eye Target Position
    this.target.position.copy(this.camera.position);
    this.target.position.x += Math.sin(this.t * 0.45) * 0.06 + this.saccadeOffset.x + this.cognitiveOffset.x;
    this.target.position.y += Math.sin(this.t * 0.30) * 0.04 + this.saccadeOffset.y + this.cognitiveOffset.y;
  }
}
