# VRM Motion V2 Architecture Specification

> Document Path: docs/vrm-motion-v2-architecture.md  
> Version: 2.0.0  
> Implementation: Warudo & ChatVRM Layered Motion Pipeline  

---

## 1. 아키텍처 개요 (Overview)

`	ext
User Speech / Chat Input
         │
         ▼
[ Electron LLM Stream ]
         │ (parseReaction: emotion, gesture, intensity)
         ▼
[ MotionIntent ]
  ├─ emotion: EmotionName
  ├─ gesture: GestureName
  ├─ gazeTarget: camera | user | away
  └─ speaking: boolean
         │
         ▼
[ MotionDirector ] (중앙 단일 모션 오케스트레이터)
  │
  ├─ [Layer 0: Base Idle Layer]
  │    └─ idle_loop.vrma (전신 Mocap 클립, 상시 LoopRepeat 무한 재생)
  │
  ├─ [Layer 1: Conversational Overlay Layer]
  │    └─ 말하는 도중 자연스러운 리듬(talk, nod, curious, giggle 등) 2.8초 간격 교차 순환
  │
  ├─ [Layer 2: Transient Gesture Layer]
  │    ├─ Three.js crossFadeTo(0.25s) 가중치 인수
  │    ├─ 전신 키네마틱스 클립 13종 (Hips, Spine, Chest, Shoulders, Arms, Wrists, Neck, Head)
  │    ├─ 타임아웃 사전 감지(returnWindow 0.35s)로 snap 없는 Base Idle 복귀
  │    └─ 쿨다운(4.5s) 및 최근 히스토리 기반 과도한 제스처 반복 억제
  │
  ├─ [Layer 3: Face & Emotion Layer]
  │    ├─ GPU Direct MorphTargetInfluences 부드러운 0~1 보간 (Speed 5.0)
  │    └─ 20% 확률 더블 블링크(Double-blink) 탑재 생체 눈 깜빡임
  │
  ├─ [Layer 4: Multi-Bone Gaze Distribution Layer]
  │    ├─ 눈(Eyes) 65% (VRMLookAt)
  │    ├─ 머리(Head) 25%
  │    ├─ 목(Neck) 15%
  │    ├─ 가슴(Chest) 10%
  │    └─ 사색 시선(Thinking Glance) 및 1.6~3.8s Saccadic 눈동자 떨림
  │
  ├─ [Layer 5: Procedural Micro-Dynamics Layer]
  │    ├─ 다중 주파수 흉곽/경추 호흡 (1.4Hz + 2.2Hz 합성)
  │    ├─ 골반 미세 체중 이동 (0.7Hz Sway)
  │    ├─ 임계 감쇠(Critically Damped) 손목 회전 스플라인
  │    └─ 30관절 손가락 순차 굽힘/펼침 (Cascading living fingers)
  │
  └─ [Layer 7: VRM Update & SpringBone Layer]
       └─ vrm.update(dt)를 통해 최종 골격 회전에 반응하는 트윈테일 머리카락/치마 자연 관성 물리 연산
`

---

## 2. 레이어 간 가중치 합성(Blending) 원칙

1. **상호 배타적 교차 페이드(CrossFade)**:
   - Base Idle과 Gesture Action은 Three.js의 crossFadeTo를 통해 서로의 가중치를 1:1로 맞바꿉니다.
   - 제스처가 켜지면 Base Idle의 상체 영향력이 0으로 내려가며, 제스처가 끝나면 다시 Base Idle이 1.0으로 복귀합니다.
   - 따라서 과거의 50:50 충돌 및 관절 덜덜거림이 구조적으로 불가능합니다.
2. **단일 렌더 루프 소유권(Single Render Ownership)**:
   - 모든 본(Bone)의 Transform은 MotionDirector와 LookAtEyes의 정해진 순서(rm.update() 전후)에 의해서만 수정되며, 개별 UI나 이벤트 리스너가 직접 본을 건드리지 않습니다.

---

## 3. 디버그 및 진단 아키텍처 (Debug & Inspection)

- **F2 단축키 HUD**:
  - knownGoodVrmaOnly: 순수 VRMA만 격리 재생하여 3D 모델의 본 리깅이 정상인지 검증.
  - proceduralEnabled: 절차적 호흡/손가락을 실시간으로 끄고 켤 수 있어 모션 소스별 영향도 분리 진단 가능.
