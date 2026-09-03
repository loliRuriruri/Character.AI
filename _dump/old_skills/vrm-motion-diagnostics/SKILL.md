---
name: vrm-motion-diagnostics
description: >
  Diagnose VRM/VRMA/three-vrm animation bugs including T-pose or partial T-pose,
  stiff or repeated gestures, wrong arm/elbow poses, raw-vs-normalized bone conflicts,
  AnimationMixer action leaks, rest-pose/retarget problems, track-filter issues,
  update-order conflicts, and animation transition snapping. Use before changing
  VRM motion architecture or when a character pose looks unnatural.
---

# VRM Motion Diagnostics

When activated, do not immediately patch bone angles.

## Required sequence
1. Read package.json and lockfile.
2. Record three / three-vrm / three-vrm-animation versions.
3. Trace VRM load and frame update paths.
4. Search all writes to rotation/quaternion/position.
5. Classify writes as raw or normalized bones.
6. Search AnimationMixer/action lifecycle.
7. Reproduce the visual bug.
8. Record base/gesture weights and active actions.
9. Dump problem AnimationClip track names.
10. Run known-good VRMA isolation test.
11. Decide whether the fault is:
   - rig/model
   - asset/retarget
   - mixer/action lifecycle
   - body mask
   - additive reference
   - raw/normalized conflict
   - procedural override
   - selector/scheduler repetition
12. Write findings before production refactor.

## T-pose specific checks
Check:
- base action weight becomes zero
- action stop/reset exposes rest pose
- gesture contains rest-pose tracks
- additive clip uses wrong reference pose
- disabled action remains with non-zero weight
- body mask unexpectedly retains upper-arm track
- old gesture action stays enabled
- normalized pose is reset between actions
- direct raw bone write runs after mixer
- animation mixer updates after procedural code and overwrites it

## Required evidence
A diagnosis must include:
- reproduction steps
- file/function names
- action names
- action weights
- track names
- relevant bone quaternions or poses
- update order
- conclusion
