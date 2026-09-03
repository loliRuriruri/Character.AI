---
name: vrm-motion-qa
description: >
  Visually and technically QA VRM character motion after animation changes.
  Detect T-pose leaks, action weight leaks, snapping, repetitive gestures,
  stiff upper-body motion, lip-sync/expression/lookAt conflicts, frame-time
  regressions, and differences across multiple VRM models. Use after every
  meaningful motion-runtime change and before declaring the VRM motion task done.
---

# VRM Motion QA

## Minimum visual test
1. 30 seconds listening idle
2. 30 seconds talking idle
3. nod small/big
4. wave
5. explain
6. thinking
7. laugh
8. 10 consecutive chat turns
9. gesture while lip-sync active
10. blink while gesture active
11. gaze while gesture active
12. background tab -> foreground

## Fail conditions
- any visible T-pose or partial T-pose in normal conversation
- base action weight accidentally reaches zero
- gesture ends with snap
- stale action remains with meaningful weight
- same gesture repeats excessively
- arm moves without shoulder/chest support
- elbow flips inward/backward
- lip sync disappears during emotion
- gaze makes head/eyes over-rotate
- frame delta spike causes pose explosion

## Multi-model test
Test at least:
- normal adult-proportion VRM
- highly stylized/chibi-ish VRM
- VRM with different optional humanoid bone availability

## Performance
Record:
- FPS
- frame time
- mixer update
- vrm update
- active action count
- cache size

## Regression
Confirm:
- chat
- STT
- TTS
- UI
- build
- tests
