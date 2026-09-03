# AI Character Chat — VRM Motion Workspace Rules

## Mission
이 프로젝트의 최우선 목표는 VRM 캐릭터가 대기/말하기/반응 중 자연스럽게 움직이도록 하는 것이다.
시각 문제를 임시 Euler angle 수정으로 숨기지 말고 root cause를 찾는다.

## Mandatory workflow
1. Read current package versions.
2. Audit existing implementation.
3. Reproduce the bug.
4. Instrument runtime state.
5. Isolate with known-good VRMA.
6. Document root cause.
7. Implement the smallest architecture change.
8. Run build/test/regression.
9. Perform visual QA.

## Source priority
1. VRM / VRMA official specification
2. Current installed @pixiv/three-vrm version docs/examples
3. Three.js official docs
4. Production VTuber design references
5. Maintained open-source implementations
6. Community articles

## Animation ownership
Do not directly manipulate avatar bones from React UI, chat handlers, TTS handlers, or random timers.
Body transform ownership belongs to the motion runtime.
LLM may emit semantic intent only.

Forbidden LLM outputs:
- Euler bone angles
- Quaternion
- World-space hand targets
- Raw bone transforms

## Base state
Base Idle must remain alive.
Do not stop/reset base idle to play a conversational gesture.
Use:
- base state crossfade
- gesture overlay fade
- additive micro motion
- optional IK correction

## T-pose rule
Any T-pose or partial T-pose visible during normal conversation is a P0 defect.
Do not hide it using a timeout or bone offset.
Capture action weights, track names, normalized/raw bone state and find the root cause.

## Dependencies
Do not upgrade three / three-vrm merely because a newer version exists.
Read package.json + lockfile first.
Major upgrades require clear compatibility evidence.

## User assets
Do not rename/delete/modify original user VRM/voice assets without an explicit runtime-copy strategy.

## Git safety
Never:
- git reset --hard
- git clean -fd
- force push
- rewrite history
unless explicitly requested by the user.

## Regression
VRM changes must not break:
- Chat
- TTS
- STT
- UI
- database/session flow

## Required docs
Maintain:
- docs/current-vrm-motion-audit.md
- docs/vrm-motion-research.md
- docs/vrm-motion-v2-architecture.md
- docs/vrm-motion-v2-test-report.md
