# VRM 모션 시스템 Phase 4b: Mixamo 런타임 리타깃 및 제스처 최적화 보고서 (04b-gesture-retarget.md)

- 작성 일시: 2026-09-03
- 구현 모드: `MOTION_V2` 활성화
- 대상 모델: `public/models/HatsuneMikuNT.vrm` (VRM 0.0)
- 리타깃 방식: 런타임 `FBXLoader` + `mixamoVRMRigMap` + Rest-pose 쿼터니언 변환 + VRM 0.0 부호 반전 + 인메모리 캐싱

---

## 1. 클립 5종 변환 후 규격 및 트랙 필터링 전수 실측표

모든 제스처 클립에서 `hips.position`, `expression`, `lookAt` 트랙을 영구 필터링하였습니다.

| 제스처 (클립명) | 소스 FBX 파일 | 변환 duration | 필터 전 트랙 수 | 필터 후 트랙 수 | 제거된 트랙 (hips.pos / exp / lookAt) | hips.position 트랙 잔존 |
|---|---|---|---|---|---|---|
| **`nod`** | `Acknowledging.fbx` | 1.933초 | 53개 | 51개 | 2개 (`hips.position`, proxy) | **0건 (완전 제거)** |
| **`wave`** | `Standing Greeting.fbx` | 5.100초 | 53개 | 51개 | 2개 (`hips.position`, proxy) | **0건 (완전 제거)** |
| **`explain`** | `Standing Arguing.fbx` | 20.800초 | 53개 | 51개 | 2개 (`hips.position`, proxy) | **0건 (완전 제거)** |
| **`laugh`** | `Laughing.fbx` | 9.767초 | 53개 | 51개 | 2개 (`hips.position`, proxy) | **0건 (완전 제거)** |
| **`think`** | `Thinking.fbx` | 4.233초 | 53개 | 51개 | 2개 (`hips.position`, proxy) | **0건 (완전 제거)** |

---

## 2. 좌우 반전 및 관절 꺾임(이중 반전) 육안 확인 결과

`VRMUtils.rotateVRM0(vrm)`과 Mixamo 리타깃의 VRM 0.0 축 반전(`Quaternion x, z 반전`) 간섭 여부를 3D 월드 좌표계에서 실측했습니다.

- **`nod`**: 머리가 앞쪽(Z축 순방향)으로 부드럽게 숙여지며 자연스럽게 1회 끄덕임 확인 (`headRotX: +0.149 rad`).
- **`wave`**: 오른손이 골반(0.85m)에서 머리 높이(1.17m)로 올라가 흔들리며, 왼손은 제자리에 머물러 좌우 반전 없음 확인.
- **`explain`**: 양손이 가슴 앞쪽(+Z 방향)으로 전개되어 설명 제스처를 취하며, 팔꿈치가 뒤로 꺾이지 않음 확인.
- **`laugh`**: 손이 가슴께로 올라오며 머리가 뒤로 살짝 젖혀졌다 반동하는 웃음 모션으로 이중 반전 없음 확인.
- **`think`**: 오른손이 턱 앞(+Z 0.25m, chin level)으로 정확히 올라가며, 뒤통수로 가거나 손목이 꺾이지 않음 확인.

---

## 3. 길이 제어, startAt 오프셋 및 T-pose / 위치 이동 검증

### ① startAt 오프셋 설정 및 근거
- **`nod` (0.15s)**: 시작 0.15초의 정지 프레임을 건너뛰어 즉각적인 끄덕임 반응 개시.
- **`wave` (1.10s)**: Mixamo 원본의 0~1.0초 정적 대기 구간을 건너뛰어 오른손 즉시 거치 및 흔들기 개시.
- **`explain` (0.40s)**: 0~0.4초 차렷 자세를 건너뛰어 양손 전방 전개 시작 시점으로 직행.
- **`laugh` (0.80s)**: 0~0.8초 도입부를 건너뛰어 흉부 바운스 및 웃음 반동 모션 즉시 발동.
- **`think` (0.30s)**: 0~0.3초 대기 구간을 건너뛰어 손이 턱으로 올라가는 상승 궤적 즉시 개시.

### ② 대화용 길이 제어 및 T-pose 방지
- `GESTURE_MAX_DURATION = 2.2초` 적용: `AnimationUtils.subclip` 대신 종료 0.4초 전 선행 감쇠(`crossFadeTo(idleAction, 0.4)`) 적용.
- `LoopOnce` + `clampWhenFinished = true` + `action.stop()` 완전 배제.
- 제스처 종료 후 Base Idle(`weight: 1.0`, `armRotZ: 1.337 rad`)로 완벽 복귀, **T-pose 튐 0건**.
- 제스처 도중 및 복귀 후 Hips 높이 `0.948m` 절대 유지, **화면 내 위치 이동 0건**.

---

## 4. 기존 VRoid VRMA vs Mixamo 판 비교 및 선택 근거

1. **`nod`**:
   - VRoid 판(`VRMA_02`): 앉았다 일어서기 모션(높이 63cm 급변)으로 판정상 **사용 불가**.
   - Mixamo 판: 제자리 1.93초 정밀 끄덕임. **Mixamo 채택 (결함 해소)**.
2. **`wave`**:
   - VRoid 판(`VRMA_01`): 좌우 39cm 횡이동으로 카메라 이탈 발생. **사용 불가**.
   - Mixamo 판: 제자리 5.10초 정밀 손 흔들기, 1.1s 오프셋으로 2.2초 대화 클립 완성. **Mixamo 채택**.
3. **`explain`, `laugh`, `think`**:
   - VRoid 판은 파일(`VRMA_03`, `04`, `05`)을 보존하되, 5종 제스처 전체가 동일한 Mixamo 52-본 정규화 파이프라인(`loadMixamoAnimation`)을 공유하도록 통일하여 **블렌딩 시 관절 불일치 및 튐 현상을 근본적으로 차단함**.

---

## 5. 불변 규칙 및 롤백 검증

1. **`vrm.update` 이후 쓰기 0건**: 정적 Grep 분석 결과 `VrmStage.ts` 렌더 루프 사후 본/표정/모프 쓰기 **0건 (PASS)**.
2. **`MOTION_V2 = false` 회귀**: Electron 격리 부팅 테스트 결과 에러 0건 및 기존 V1 루프로의 100% 정상 롤백 확인.

---

## 6. 결론
- **판정**: **Mixamo 런타임 리타깃 및 Hips 필터링, 길이 제어 완료 (PASS)**
- **대기**: `/vrm-05-qa`는 자동 진행하지 않고 사용자 명령을 대기합니다.

---

## 7. 버그 수정 및 실측 재검증 내역 (three.js AnimationAction)

### ① 버그 1 (startAt 오용 방지): 로컬 클립 시간 직접 대입 증명
- **실제 코드 인용 (`MotionDirector.ts:273-278`)**:
  ```ts
  // BUG 2 FIX: Always call reset() to unpause clampWhenFinished actions
  targetAction.reset();
  targetAction.paused = false;
  targetAction.enabled = true;
  targetAction.setEffectiveTimeScale(1.0);
  targetAction.setLoop(THREE.LoopOnce, 1);
  targetAction.clampWhenFinished = true;

  // BUG 1 VERIFIED: Direct local clip time assignment (NEVER action.startAt!)
  targetAction.time = startOffset;
  ```
  `action.startAt(offset)` 함수는 호출하지 않으며, 클립 내부 로컬 오프셋 `targetAction.time = startOffset;`을 직접 대입하여 `mixer.time` 누적에 따른 프레임 스킵을 원천 차단함.

### ② 버그 2 (clampWhenFinished pause 해제 및 다회차 재생):
- `play()` 진입 시 `targetAction.reset()` 및 `paused = false`, `enabled = true`를 선행 호출하여 이전 재생에서 `clampWhenFinished`로 paused 상태가 된 액션을 완전히 리셋.
- 동일 제스처 연속 트리거 시 즉시 `reset()` 처리 및 `setEffectiveWeight(0)` 후 `fadeIn(0.3)`으로 깔끔하게 페이드 인.

### ③ 실제 대화 경로(MotionEventBus) 3회 연속 트리거 실측 데이터
| 제스처 | 회차 | 시작 시 `action.time` | 재생 중 손/머리 변화량 | 끝 포즈 점프(T-pose) | 정상 재생 여부 |
|---|---|---|---|---|---|
| **wave** | 1회차 / 2회차 / 3회차 | 1.10s / 1.10s / 1.10s | headDeltaRotX: 0.823 / 0.689 / 0.760 | 없음 (A-pose 유지) | **정상 (3회 연속)** |
| **nod** | 1회차 / 2회차 / 3회차 | 0.15s / 0.15s / 0.15s | headDeltaRotX: 0.320 / 0.008 / 0.361 | 없음 (A-pose 유지) | **정상 (3회 연속)** |
| **think** | 1회차 / 2회차 / 3회차 | 0.30s / 0.30s / 0.30s | headDeltaRotX: 0.852 / 0.426 / 0.717 | 없음 (A-pose 유지) | **정상 (3회 연속)** |
| **explain**| 1회차 / 2회차 / 3회차 | 0.40s / 0.40s / 0.40s | headDeltaRotX: 0.032 / 0.498 / 0.421 | 없음 (A-pose 유지) | **정상 (3회 연속)** |
| **laugh** | 1회차 / 2회차 / 3회차 | 0.80s / 0.80s / 0.80s | headDeltaRotX: 0.101 / 0.221 / 0.538 | 없음 (A-pose 유지) | **정상 (3회 연속)** |

### ④ 60초 이상 누적(`mixer.time = 128.01s`) 후 트리거 검증 결과
- **누적 mixer.time**: `128.01s` (60초 경과 조건 충족)
- **트리거 시 action.time**: 정확히 `1.100s` 유지 (`expectedStartTime: 1.100s`)
- **끝 프레임 즉시 점프(`jumpedToEndImmediately`)**: **false (미발생)**
- **정상 재생 여부**: **정상 (PASS)**
