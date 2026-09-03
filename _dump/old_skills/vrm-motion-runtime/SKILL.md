---
name: vrm-motion-runtime
description: >
  Implement and refactor the AI character VRM motion runtime using VRMA,
  Three.js AnimationMixer, persistent base idle, talking/listening base states,
  gesture overlays, additive micro motion, semantic MotionIntent, MotionScheduler,
  head/eye separation, expression and lip-sync ownership, optional IK, and
  SpringBone-safe frame updates. Use when implementing VRM Motion V2.x.
---

# VRM Motion Runtime

## Core ownership
The LLM produces semantic intent only.

Runtime owns:
- animation asset selection
- clip compilation
- fade durations
- cooldown
- scheduler
- body masks
- additive blending
- gaze
- head aim
- hand pose
- IK
- expression weights
- lip-sync inputs

## Mandatory layers
1. Base State
   - listening idle
   - talking idle
2. Gesture Overlay
   - nod
   - wave
   - explain
   - laugh
   - thinking
3. Additive Micro Motion
   - breathing
   - subtle weight shift
   - shoulder settling
4. Face
   - emotion
   - blink
   - mouth
5. Gaze
   - VRM eye lookAt
   - separate head aim
6. Optional IK
   - only after FK/VRMA is verified

## Critical rule
Base idle must not be stopped/reset to play a normal conversational gesture.

## Caches
Separate:
- VRMA source asset cache
- per-VRM compiled AnimationClip cache

## Scheduling
Do not hold one gesture for an entire long TTS response.
Schedule gestures around:
- speech start
- sentence boundaries
- pauses
- emphasis
- recent gesture history
- cooldown

## Frame ownership
Write intended humanoid/expression/gaze inputs first, then allow the current
three-vrm version's official update path to apply humanoid sync, constraints,
expressions and SpringBone.
Do not double-update LookAt or SpringBone.
