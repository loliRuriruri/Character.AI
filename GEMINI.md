# MikuChat v3 — Pair-Programming & Collaboration Rules

## 1. Multi-Agent Role Boundary (Codex & Antigravity)
This repository is concurrently maintained by multiple AI assistants (e.g. Codex and Antigravity). To avoid merge conflicts and maximize efficiency:

- **Antigravity Scope**:
  - 3D Character Engine & VRM Stage: `src/character/` (`VrmStage.ts`, `GestureEngine.ts`, `LookAtEyes.ts`, `BlinkEngine.ts`, `VisemeDriver.ts`).
  - Motion Kinematics, Rigging, Easing, and Keyframe Choreography.
  - Dialog Semantic Reaction Pipeline: `src/shared/emotion.ts`.
- **Codex Scope**:
  - TTS engines & audio synthesis: `electron/tts.ts`, `electron/voices.ts`.
  - Overlay UI, Settings window, menus: `src/overlay/`, `src/settings/`, `settings.html`.
- **Shared Interface Protocol**:
  - `src/shared/types.ts` & `src/shared/ipc.ts`: When adding new gestures or emotions, always APPEND new enum/union values without removing or altering existing ones to preserve zero-breakage compatibility with Codex's UI.

---

## 2. 3D Motion & Kinematics Principles
- **Kinetic Chain**: Upper arm movements must always be accompanied by clavicle/shoulder elevation and subtle chest counterbalance.
- **Overshoot & Settle**: All keyframed actions must have an overshoot phase followed by smooth elastic settling.
- **Saccadic Gaze**: Eyes must feature micro-darting and look-away behaviors during thinking and speaking, avoiding an unnatural static stare.
- **Fluid Wrists & Cascading Fingers**: Maintain continuous dampening on hands and finger joints (3-joint cascades) so character hands feel organic and alive.

---

## 3. Rendering Stability
- **Depth Offset**: Maintain polygon offsets on facial layers (eyes, eyebrows) to eliminate z-fighting across all loaded VRM avatars.
- **Morph Safety**: Keep defect-prone morph targets (cheek rings `はぅ`, downward eye distortion `下`) suppressed to prevent visual glitches.
