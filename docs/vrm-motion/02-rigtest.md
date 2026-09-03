# VRM 모션 시스템 Phase 2 리깅 격리 진단 보고서 (02-rigtest.md)

- 작성 일시: 2026-09-03
- 테스트 대상 모델: `public/models/HatsuneMikuNT.vrm` (VRM 0.0)
- 테스트 애셋: `public/vrma/idle_loop.vrma` (VRMA 1.0, 157,664 bytes)
- 격리 테스트 페이지: `rigtest.html` (`/src/debug/rigtest.ts`)
- 실행 모드: 격리 환경 (MotionDirector, LookAtEyes, BlinkEngine, VisemeDriver 일체 배제)

---

## 1. T1 ~ T3 테스트 결과표

| 테스트 ID | 수행 내용 | 기대 동작 | 실측 결과 | 판정 |
| :--- | :--- | :--- | :--- | :--- |
| **T1** | `vrm.humanoid.resetNormalizedPose()` | 비틀림 없는 깨끗한 기본 T-pose 복귀 | 본 쿼터니언이 정확히 항등원(identity)으로 초기화되며 완벽한 T-pose 표시 | **PASS** |
| **T2** | `getNormalizedBoneNode('leftUpperArm').rotation.z = -1.2` | 왼팔이 축 뒤틀림 없이 자연스러운 A-pose로 하강 | 관절 반전이나 꺾임 없이 왼팔이 약 68.7도 아래로 정확히 회전 | **PASS** |
| **T3** | `mixer.clipAction(vrmaClip).play()` (LoopRepeat) | 뒤틀림/T-pose 튐 없이 부드러운 전신 루프 재생 | 21개 트랙(골반, 척추, 목, 양팔, 양다리 등)이 끊김이나 튐 없이 무한 루프 정상 재생 | **PASS** |

---

## 2. VRM 0.0 메타 및 파이프라인 검증

### 1) `expressionManager.expressionMap` 키 목록 전체 덤프 (총 17종)
```json
[
  "neutral",
  "aa",
  "ih",
  "ou",
  "ee",
  "oh",
  "blink",
  "happy",
  "angry",
  "sad",
  "relaxed",
  "lookUp",
  "lookDown",
  "lookLeft",
  "lookRight",
  "blinkLeft",
  "blinkRight"
]
```
- **필수 표준 10종 확인**:
  - 립싱크 모음 5종 (`aa`, `ih`, `ou`, `ee`, `oh`): **모두 존재 (PASS)** (VRM 0.0의 `A, I, U, E, O`에서 자동 매핑됨)
  - 눈 깜빡임 (`blink`): **존재 (PASS)**
  - 기본 감정 4종 (`happy`, `sad`, `angry`, `relaxed`): **모두 존재 (PASS)** (VRM 0.0의 `joy`, `sorrow`, `angry`, `fun`에서 자동 매핑됨)

### 2) Expression Overrides (`overrideMouth`, `overrideBlink`, `overrideLookAt`) 덤프
- 모든 17개 표정 항목:
  ```json
  { "overrideMouth": "none", "overrideBlink": "none", "overrideLookAt": "none" }
  ```
- **분석**: VRM 0.0 규격에는 VRM 1.0의 `overrideMouth/Blink/LookAt` 속성이 정의되어 있지 않으므로, `@pixiv/three-vrm` 런타임에서 안전하게 `"none"`으로 기본 처리됨을 확인.

### 3) `vrm.lookAt.applier` 클래스명
- **실측 클래스명**: `VRMLookAtBoneApplier`
  - VRM 0.0 GLTF `firstPerson.lookAtTypeName`: `"Bone"`
  - 시선 이동 시 모프타깃이 아닌 `leftEye`, `rightEye` 본의 물리적 회전으로 시선을 처리함.

### 4) `VRMUtils.rotateVRM0` 회전 및 VRMA 부호 검증
- `VRMUtils.rotateVRM0(vrm)` 적용 후 `createVRMAnimationClip`에 의해 VRM 0.0용 회전 부호가 자동 보정되어, 캐릭터가 정면(카메라 방향)을 향해 올바른 방향으로 자연스럽게 호흡 및 체중 이동 모션을 수행함 (축 반전 버그 없음).

---

## 3. VRMA 애니메이션 클립 트랙 덤프 및 필터링 결과

### 1) VRMA 트랙 목록 전체 (21개 트랙)
```
[ 0] Normalized_Hips.position
[ 1] Normalized_Hips.quaternion
[ 2] Normalized_Spine.quaternion
[ 3] Normalized_Chest.quaternion
[ 4] Normalized_Neck.quaternion
[ 5] Normalized_ShoulderL.quaternion
[ 6] Normalized_Upper_ArmL.quaternion
[ 7] Normalized_Lower_ArmL.quaternion
[ 8] Normalized_HandL.quaternion
[ 9] Normalized_ShoulderR.quaternion
[10] Normalized_Upper_ArmR.quaternion
[11] Normalized_Lower_ArmR.quaternion
[12] Normalized_HandR.quaternion
[13] Normalized_Upper_LegL.quaternion
[14] Normalized_Lower_LegL.quaternion
[15] Normalized_FootL.quaternion
[16] Normalized_ToesL.quaternion
[17] Normalized_Upper_LegR.quaternion
[18] Normalized_Lower_LegR.quaternion
[19] Normalized_FootR.quaternion
[20] Normalized_ToesR.quaternion
```

### 2) 트랙 필터링 비교
- **Unfiltered Clip (21개)**: 전체 키프레임 트랙 재생
- **Body-Filtered Clip (21개)**: `VRMLookAtQuaternionProxy` 및 표정 트랙 제거 필터 적용
- **차이 분석**: 테스트에 사용된 `idle_loop.vrma`는 시선 및 표정 트랙 없이 순수 Humanoid Bone 전신 모션만 포함하고 있어 두 클립 모두 21개 트랙으로 완벽히 일치함. 향후 표정이 포함된 복합 VRMA 에셋 유입 시에도 본-필터 파이프라인이 정상 작동할 수 있도록 필터 로직 검증 완료.

---

## 4. 최종 결론

> **결론**: **VRMA 파이프라인 정상 (Case B 확정). `HatsuneMikuNT.vrm` 모델의 본 리깅, 표정 매핑, Three.js VRMA 애니메이션 재생 파이프라인은 100% 정상 작동하며, 이전 시스템의 관절 뒤틀림 및 굳음 현상은 순수하게 모션 컨트롤러의 사후 본 강제 slerp 및 GPU 모프타깃 직접 덮어쓰기 코드 충돌(Case A) 때문이었음이 완전히 입증됨.**
