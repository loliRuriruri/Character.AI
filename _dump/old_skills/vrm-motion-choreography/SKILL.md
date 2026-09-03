---
name: vrm-motion-choreography
description: >-
  Advanced engineering guide and kinematics patterns for realistic, organic 3D character motion,
  VRM humanoid rigging, keyframe easing, weight shifting, and secondary procedural dynamics in Three.js and @pixiv/three-vrm.
---

# VRM Character Rigging & Organic Motion Choreography

This skill provides comprehensive patterns, biomechanical guidelines, and mathematical models for driving VRM 0.0/1.0 avatars with lifelike, expressive, and non-robotic motion in Three.js.

---

## 1. Biomechanical Fundamentals for VRM Humanoids

When authoring procedural or keyframed animations for anime-style VRM models:

### A. The Kinetic Chain (부모-자식 관절 계층 연동)
A human arm NEVER moves isolated from the body:
- **Pelvis / Hips**: The center of gravity. When arms rise or the character gestures, `hips` must shift slightly opposite or tilt to balance weight.
- **Spine & Chest**: Any expressive gesture requires chest expansion/rotation (pitch for breathing/enthusiasm, yaw for addressing the user).
- **Shoulders / Clavicles (견갑골/쇄골 연동)**:
  - **Crucial Rule**: When lifting an arm above 45 degrees, the `leftShoulder` or `rightShoulder` MUST rotate upward (elevation: ~0.1-0.18 rad) and forward (protraction).
  - Without shoulder movement, arms look mechanically dislocated from the torso.
- **Lower Arm (Elbow) & Upper Arm Rotation**:
  - Elbows naturally have slight inward pronation/supination.
  - Avoid gimbal lock; rotate using proper Euler orders (`YXZ` or `ZXY`) or Quaternions.

### B. The 12 Principles of Animation Applied to VRM
1. **Anticipation (예비 동작)**: Before raising a hand, the hand drops slightly (50-100ms) or the chest draws back before lunging forward.
2. **Overshoot & Settle (오버슈트와 정착)**: Never stop directly at the destination keyframe. Pass the target by 5-10% and elastic-spring back into the settled pose.
3. **Follow-Through & Overlapping Action (팔로우 스루 & 시차)**:
   - Torso starts first -> Upper arm follows (80ms later) -> Lower arm follows (120ms later) -> Wrist flicks (180ms later) -> Fingertips settle last.
4. **Slow-In and Slow-Out (Ease In/Out)**: Never use linear interpolation (`LinearInterpolant`) on limbs. Use sinusoidal, cubic-bezier, or critically damped spring lerp.

---

## 2. Advanced Procedural Layering Architecture

To prevent the avatar from looking like a frozen statue between keyframes, layer 4 procedural passes in the render loop:

```
[Base Layer: Idle Motion / VRMA Clip]
       │
       ▼
[Keyframe Action Mixer (Gesture Clips: Fade In/Out with Clamping)]
       │
       ▼
[Procedural Spine & Hip Balancing (Sine breathing + organic sway)]
       │
       ▼
[Critically Damped Wrist Springs (Euler Slerp trajectory)]
       │
       ▼
[Living 30-Joint Finger Dynamics (Cascade ripple + speech expansion)]
       │
       ▼
[LookAt & Saccadic Eye Micro-Darting]
```

### Layer Code Patterns

#### 1. Organic Breathing & Weight Shifting
```typescript
// Gentle, non-repeating dual-frequency breathing
const t = clock.getElapsedTime();
const breath = Math.sin(t * 1.4) * 0.012 + Math.sin(t * 2.1) * 0.004;
const hipSway = Math.sin(t * 0.6) * 0.008;
chestNode.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(breath, 0, 0)));
hipsNode.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, hipSway, 0)));
```

#### 2. Wrist Spring Damping (Zero Angular Corners)
```typescript
// Smooth spring slerp avoids mechanical robotic snaps
wristNode.quaternion.slerp(targetWristQuat, Math.min(1.0, delta * 10.0));
```

#### 3. Anatomical Finger Cascading
Fingers have 3 phalanges: Proximal, Intermediate, Distal.
- Proximal initiates curl (`c`).
- Intermediate curls `1.2 * c`.
- Distal curls `0.8 * c`.
- Phase shift each finger index by `i * 0.25s` to generate natural organic ripple rather than a stiff wooden paddle.

---

## 3. High-Fidelity Gesture Catalog Spec

Every gesture must have:
- **Lead-in (Anticipation)**: 0.15 - 0.3s
- **Primary Climax / Action**: Hold with micro-sway (0.8 - 1.5s)
- **Cushioned Recovery (Return to Idle)**: 0.4 - 0.6s smooth fade
- **Head & Neck Acting**: Every gesture MUST express emotion through neck tilt (`z`), nodding (`x`), or turning (`y`).

---

## 4. VRM Pitfalls & Stability Checklist

- [ ] **Material Z-Fighting**: Check `polygonOffset` on eye/eyebrow meshes so facial expressions don't clip with face geometry.
- [ ] **Morph Artifacts**: Never drive conflicting morph targets (e.g. check for cheek ring artifacts like `はぅ` or distortion targets).
- [ ] **Bone Normalization**: Always use `vrm.humanoid.getNormalizedBoneNode()` rather than raw scene hierarchy names to ensure cross-model compatibility.
