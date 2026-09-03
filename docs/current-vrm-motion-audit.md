# VRM Motion System Audit & Root Cause Analysis

> Document Path: docs/current-vrm-motion-audit.md  
> Verification Date: 2026-09-03  

---

## 1. 기존 아키텍처 및 호출 경로 분석

### 1.1 데이터 흐름 (Data Flow)
1. 사용자가 채팅 메시지 전송
2. Electron 메인 프로세스(electron/main.ts)에서 LLM 스트리밍 응답 수신
3. parseReaction() 정규식 및 키워드 분석을 통해 emotion, gesture 결정
4. Ipc.GESTURE, Ipc.EMOTION 브로드캐스트
5. character/main.ts가 수신하여 stage.play(name), stage.setEmotion(emo) 호출
6. VrmStage.ts가 렌더 루프(requestAnimationFrame)에서 애니메이션, 시선, 블링크, 립싱크, VRM 업데이트 수행

---

## 2. 발견된 문제점 및 근본 원인 (Root Cause)

### 2.1 [Root Cause 1] Idle VRMA vs Gesture 50:50 가중치 충돌
- **위치**: GestureEngine.ts (play 메서드)
- **현상**: idle_loop.vrma(Base Idle)가 weight 1.0으로 도는 상태에서 제스처가 weight 1.0으로 재생됨.
- **원인**: Three.js AnimationMixer는 동일 본 트랙이 2개 액션에 존재할 때 50:50으로 단순 평균 블렌딩함. VRMA는 팔을 내리려 하고 제스처는 팔을 올리려 하므로, 팔이 약 50% 각도에서 멈춘 채 굳어버림.

### 2.2 [Root Cause 2] clampWhenFinished = true와 finished 이벤트 차단
- **위치**: GestureEngine.ts (생성자 및 finished 리스너)
- **현상**: 미쿠가 답변을 말하는 도중 제스처가 끝나면 !this.isSpeaking 조건문 때문에 finished 핸들러가 무시됨.
- **원인**: LoopOnce 액션은 finished 이벤트를 단 한 번만 발생시키므로, 이후 말이 끝나도 Idle로 복귀하지 못하고 마지막 프레임에 영원히 clamp(고정)됨.

### 2.3 [Root Cause 3] 운동학적 사슬(Kinetic Chain) 부재
- **위치**: 기존 키프레임 생성 코드
- **현상**: 팔만 움직이고 골반, 척추, 흉곽, 어깨, 목이 전혀 반응하지 않아 통나무 몸통에 마네킹 팔만 달린 것처럼 어색함.

### 2.4 [Root Cause 4] 시선 집중 단일 관절 왜곡
- **위치**: LookAtEyes.ts
- **현상**: 눈동자만 100% 돌아가 사시처럼 카메라를 노려보고, 머리와 상체가 시선 방향을 따라가지 않음.

---

## 3. 본 쓰기(Bone Write) 전수 감사 표

| 파일 | 함수/메서드 | 대상 본 | 방식 | 실행 시점 | 문제 여부 및 조치 |
|---|---|---|---|---|---|
| MotionDirector.ts | mixer.update() | 전신 55개 본 | Normalized AnimationMixer | 매 프레임 | 해결 (CrossFade로 가중치 분리) |
| MotionDirector.ts | applyProceduralDynamics | chest, neck, hips | Normalized Quaternion Multiply | 매 프레임 | 해결 (정규화 normalize() 적용) |
| MotionDirector.ts | applyFluidWrists | leftHand, rightHand | Normalized slerp | 매 프레임 | 정상 (스프링 보간) |
| MotionDirector.ts | applyLivingFingers | 30개 손가락 본 | Normalized slerp | 매 프레임 | 정상 (30관절 순차 보간) |
| LookAtEyes.ts | restoreHead | chest, neck, head | Normalized slerp | 매 프레임 (vrm.update 직후) | 해결 (눈 65%, 머리 25%, 목 15%, 가슴 10% 분산) |
| VrmStage.ts | updateDirectMorphTargets | GPU MorphTargets | Direct float | 매 프레임 | 정상 (GPU 직접 연산, 0~1 부드러운 lerp) |

---

## 4. 프레임 업데이트 순서 (Frame Update Order)

최종 확정된 프레임 업데이트 순서:
1. motion.update(dt) : AnimationMixer 평가 및 Idle/Gesture CrossFade, Procedural Dynamics
2. look.captureHead() & look.update(dt) : 시선 타겟 위치 계산 및 기준 포즈 캡처
3. blink.update(dt) & viseme.update(dt) : 눈 깜빡임 및 립싱크 가중치 계산
4. vrm.update(dt) : Normalized to Raw 동기화 및 SpringBone 물리(머리카락, 옷) 시뮬레이션
5. look.restoreHead(dt) : 다관절 시선 분산 (가슴 10%, 목 15%, 머리 25%)
6. updateDirectMorphTargets(dt) : 표정 GPU morph 보간
7. renderer.render() : 최종 WebGL 렌더링
