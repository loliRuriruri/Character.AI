---
name: vrm-triage
description: Fast 3-minute triage procedure to isolate whether a VRM avatar motion problem comes from the model rig, the humanoid normalization, duplicated update calls, or the custom motion controller. Use before writing any audit document or refactoring motion code.
---

# VRM 모션 문제 3분 분류 절차

감사 문서를 길게 쓰기 전에 **이것부터** 한다. 순서대로, 하나라도 실패하면 거기서 멈추고 보고한다.

## T1. resetNormalizedPose 테스트

개발 콘솔 또는 디버그 버튼에서:

```js
vrm.humanoid.resetNormalizedPose();
```

기대: 정확한 T-pose.

- 실패(T-pose가 안 나옴, 팔이 꺾임, 모델이 뒤틀림)
  → **rig 또는 로더 문제.** humanoid bone 매핑, VRM 버전, 모델 변환 과정을 먼저 본다.
  이 상태에서 상위 레이어를 아무리 고쳐도 소용없다. 여기서 멈추고 보고한다.
- 성공 → T2로.

## T2. 단일 본 수동 회전 테스트

```js
vrm.humanoid.getNormalizedBoneNode('leftUpperArm').rotation.z = -1.2;
```

기대: 왼팔이 자연스럽게 옆으로 내려온다(A-pose).

- 예상대로 움직임 → **rig 정상. 문제는 100% 컨트롤러다.** T3로.
- 이상하게 꺾임 → raw/normalized 혼용 의심. 코드에서 `getRawBoneNode` 사용처를 전수 조사.
- 아무 변화 없음 / 즉시 원복 → 다른 시스템이 매 프레임 덮어쓰고 있다. T3에서 잡는다.

## T3. vrm.update 호출 횟수 카운터

렌더 루프에 카운터를 심고 1초간 호출 횟수를 센다.

```js
let n = 0;
const orig = vrm.update.bind(vrm);
vrm.update = (d) => { n++; orig(d); };
setInterval(() => { console.log('vrm.update/s =', n); n = 0; }, 1000);
```

기대: FPS와 동일한 수치.

- FPS의 2배 이상 → **update 중복 호출.** 그 자체로 humanoid sync와 springbone이 깨진다.
  호출 지점을 전부 찾아 하나로 통합한다.

## T4. 본 소유권 충돌 스캔

저장소 전체에서 다음 패턴을 검색하고 위치를 기록한다.

```
getRawBoneNode      getNormalizedBoneNode     getBoneNode
.rotation.          .quaternion.              .position.
setPose  setRawPose  setNormalizedPose  resetNormalizedPose
expressionManager.setValue
lookAt.target       lookAt.applier
vrm.update(         mixer.update(
requestAnimationFrame   useFrame
```

각 결과를 표로 정리한다:

| 파일:라인 | 함수 | 대상 본/표정 | Raw/Normalized | 실행 시점 | 충돌 대상 |

동일한 본 또는 동일한 expression을 **두 곳 이상**에서 쓰고 있으면 그게 root cause 후보다.

## T5. known-good VRMA 재생 (분리 진단의 결정타)

커스텀 모션 컨트롤러를 전부 끈 상태에서 공식 방식으로만 VRMA를 재생한다.
`three-vrm-api-facts` 스킬의 1·2·3·4항을 그대로 따른다.

- **Case A — VRMA도 팔/어깨가 이상하다**
  → rig 문제. 모션 아키텍처 리팩터링을 시작하지 말고 rig부터 고친다.
- **Case B — VRMA는 자연스럽다**
  → 커스텀 컨트롤러가 원인. legacy 격리 후 신규 아키텍처로 진행.

## 보고 형식

```markdown
## Triage 결과
- T1 resetNormalizedPose: PASS / FAIL (근거)
- T2 단일 본 회전:        PASS / FAIL (근거)
- T3 vrm.update 횟수:     N회/s (FPS M) → 정상 / 중복
- T4 본 소유권 충돌:      N건 (표 첨부)
- T5 known-good VRMA:     Case A / Case B (스크린샷 첨부)

## Root Cause (한 문장으로 확정)
...

## 재현 절차
1. ...
```

root cause를 한 문장으로 못 쓰겠으면 아직 진단이 안 끝난 것이다. 코드를 고치지 마라.
