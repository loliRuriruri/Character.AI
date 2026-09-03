---
name: three-vrm-api-facts
description: Verified facts about @pixiv/three-vrm 3.x, VRM 1.0 spec, and three.js AnimationMixer behavior for VRM avatars. Use when writing or reviewing any code that loads VRM files, plays VRMA animations, manipulates humanoid bones, sets expressions, controls lookAt, or updates the render loop.
---

# three-vrm / VRM 검증된 사실

> 아래는 @pixiv/three-vrm `dev` 브랜치 소스코드와 VRM 1.0 공식 스펙을 직접 확인한 내용이다.
> 이 문서와 충돌하는 블로그/예제는 무시한다.
> 단, 이 저장소에 설치된 버전이 3.x가 아니면 먼저 node_modules에서 실제 소스를 확인하라.

## 1. 업데이트 순서는 소스에 확정되어 있다

`VRMCore.update(delta)` → `VRM.update(delta)` 실제 구현:

```
humanoid.update()              // normalized bone -> raw bone 복사
lookAt.update(delta)
expressionManager.update()     // override 규칙 계산 포함
nodeConstraintManager.update()
springBoneManager.update(delta)
materials.forEach(m => m.update(delta))
```

따라서 프레임 루프의 유일한 정답 구조:

```ts
function tick(dtRaw: number) {
  const dt = Math.min(dtRaw, 0.1);      // 탭 복귀 스파이크 방어

  mixer.update(dt);                      // 1. 클립 재생 (normalized bone에 씀)
  director.updateProcedural(dt);         // 2. normalized bone에 곱셈으로 오버레이
  director.updateLookAtTarget(dt);       // 3. vrm.lookAt.target 지정
  director.updateExpressions(dt);        // 4. expressionManager.setValue(...)
  director.updateLipSync(dt);            // 5. 입 모양 setValue

  vrm.update(dt);                        // 6. 딱 한 번. 반드시 마지막.
  renderer.render(scene, camera);
}
```

`setValue`와 `lookAt.target` 지정은 반드시 `vrm.update()` **이전**이어야 그 프레임에 반영된다.
`vrm.update()`가 프레임당 2회 이상 호출되면 humanoid sync와 springbone이 깨진다. 카운터로 검증하라.

## 2. VRMA는 normalized rig 위에서 재생된다

`createVRMAnimationClip.ts` 내부는 트랙 이름을 이렇게 만든다:

```ts
const nodeName = humanoid.getNormalizedBoneNode(name)?.name;
new THREE.QuaternionKeyframeTrack(`${nodeName}.quaternion`, ...)
```

`VRMHumanoidRig`는 각 본의 world position은 계승하되 rotation은 부모 world rotation으로 보정해 만든다.
따라서 **normalized rig의 rest pose는 모든 모델에서 동일한 T-pose이고 초기 quaternion은 identity**다.

결론:
- 절차적 제어는 **전부 normalized bone에서** 한다. raw bone은 읽기 전용으로만 취급한다.
- normalized 좌표계에서 T-pose 기준 왼팔은 +X, 오른팔은 -X 방향이다.
- 왼쪽 upperArm의 local Z를 약 -70°(-1.2rad) 돌리면 자연스러운 A-pose. 오른쪽은 부호 반대.
- 이 규약은 모델이 바뀌어도 유지된다. "모델별 축 차이" 문제가 사라지는 이유가 이것이다.
- `humanoid.autoUpdateHumanBones`를 끄면 normalized→raw 복사가 멈춘다. 특수한 경우 외엔 건드리지 마라.

유용한 API:
`getNormalizedBoneNode(name)` / `getRawBoneNode(name)` / `getNormalizedPose()` /
`setNormalizedPose()` / `resetNormalizedPose()` / `normalizedRestPose` / `rawRestPose`
(`restPose`는 deprecated. 쓰면 콘솔 경고가 뜬다.)

## 3. VRMLookAtQuaternionProxy 는 순서가 중요하다

```ts
const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
proxy.name = 'VRMLookAtQuaternionProxy';   // 이름 반드시 지정
vrm.scene.add(proxy);
// 그 다음에야 createVRMAnimationClip(...) 호출
```

이름을 안 주면 createVRMAnimationClip이 경고를 뿌리며 자동으로 이름을 붙인다.
scene에 먼저 추가하지 않으면 lookAt 트랙이 만들어지지 않는다.

## 4. VRMA의 expression / lookAt 트랙이 우리 시스템을 덮어쓴다 (매우 중요)

`createVRMAnimationClip`은 humanoid 트랙뿐 아니라
`expressionManager.getExpressionTrackName()` 기반 expression 트랙과
LookAt 프록시 quaternion 트랙까지 함께 만든다.

즉 제스처 VRMA에 표정/시선 키가 있으면 **mixer가 립싱크·감정·gaze를 매 프레임 짓밟는다.**

따라서 클립 생성 직후 반드시 필터링한다:

```ts
const full = createVRMAnimationClip(vrmAnimation, vrm);
const bodyOnly = new THREE.AnimationClip(
  full.name + '_body',
  full.duration,
  full.tracks.filter(t =>
    !t.name.includes('VRMLookAtQuaternionProxy') &&
    !t.name.startsWith(EXPRESSION_TRACK_PREFIX)   // 실제 prefix는 런타임에 확인
  ),
);
```

expression 트랙 이름 형식은 설치된 버전의
`expressionManager.getExpressionTrackName('happy')` 를 콘솔에서 직접 호출해 확인한 뒤 하드코딩하라.

## 5. VRM 0.x 모델은 부호가 반전된다

`createVRMAnimationClip`은 `vrm.meta.metaVersion === '0'` 일 때
rotation의 x·z 성분과 translation 성분 부호를 뒤집는다.
`VRMUtils.rotateVRM0(vrm)` 호출 여부와 맞물려 "VRMA 재생하면 뒤돌아 있거나 팔이 반대로 꺾임" 증상이 난다.
VRM0 모델을 지원한다면 QA에 반드시 포함하라.

## 6. AnimationAction.stop() 이 snap의 원인이다

- `stop()`은 three.js `PropertyMixer`가 저장한 original state로 즉시 복원 → 1프레임 튐.
- 반대로 mixer가 어떤 본의 트랙을 더 이상 평가하지 않으면 `humanoid.update()`는 리셋을 하지 않으므로
  그 본은 **마지막 값에 그대로 얼어붙는다.**

"움직임 → 정지" 끊김 증상은 거의 항상 이 둘 중 하나다.

규칙:
- 제스처 종료는 `fadeOut(t)` 또는 `crossFadeTo(idleAction, t, false)`.
- 제스처 클립과 idle 클립의 **트랙 집합을 일치**시킨다. 즉 제스처도 풀바디 클립으로 만든다.
- `clampWhenFinished` + `LoopOnce` 사용 시 finished 이벤트에서 crossFade로 복귀시킨다.
- 다 쓴 액션은 `mixer.uncacheAction(clip, root)` / `uncacheClip(clip)` 으로 정리한다. 누적 방지.

권장 fade 값 (고정 상수 아님, 제스처 메타데이터로 둘 것):
fadeIn 0.20~0.40s / fadeOut 0.25~0.50s

## 7. 마스킹 대신 additive를 쓴다

three.js에는 Unity Avatar Mask가 없다. 흉내내면 spine 경계에서 상하체가 따로 논다.

정답 구조:
- **바디 레이어**: idle과 gesture 모두 **풀바디 클립**, `NormalAnimationBlendMode`, crossFade만 사용. 마스크 없음.
- **오버레이**: 호흡/sway/head drift 같은 저진폭 모션만 코드로 normalized bone에 곱하거나
  `AnimationUtils.makeClipAdditive(clip, refFrame, refClip)` + `THREE.AdditiveAnimationBlendMode` 사용.

주의: VRMA 제스처는 T-pose 기준 **절대 포즈**다. additive로 변환하면 "idle 포즈 + 제스처 델타"가 되어
팔이 이중으로 올라간다. 제스처에 additive를 쓰지 마라.

`makeClipAdditive`는 기본적으로 클립 자신의 첫 프레임 기준으로 삼는다.
rest pose 기준 델타가 필요하면 세 번째 인자 `referenceClip`에 rest 포즈 클립을 넘겨야 한다.

## 8. 표정이 립싱크를 죽이는 스펙상 이유

VRM 1.0 expressions 스펙에는 `overrideMouth`, `overrideBlink`, `overrideLookAt` 이 있고
값은 `none` / `block` / `blend` 다.

모델러가 `happy` 표정에 `overrideMouth: block`을 걸어둔 경우가 흔하다.
그러면 three-vrm이 스펙대로 `aa/ih/ou/ee/oh`를 자동으로 0으로 만든다.
"감정 표현 때문에 립싱크가 사라진다"는 증상의 진짜 원인이 이것이며, 우리 코드 버그가 아니다.

대응:
- 로드 시 각 preset expression의 override 설정을 읽어 콘솔/디버그 패널에 표시한다.
- 발화 중에는 emotion weight를 0.5~0.6으로 제한한다 (`blend`면 weight 비례 감쇠).
- `block`이면 발화 중 해당 표정 사용을 아예 회피하고 다른 표정으로 대체한다.

## 9. 절차적 미세 모션 수치 가이드

`Math.sin` 자체가 문제가 아니다. 모든 관절에 **같은 위상·같은 주파수**를 쓰는 게 문제다.

- 호흡: 0.2~0.3Hz sin. upperChest/chest 1~2°, spine 0.5°, 어깨는 위상을 약간 지연.
- 체중 이동 / head drift: sin이 아니라 1D simplex noise, 0.05~0.15Hz.
- 상관관계: head는 chest 값의 60~70%를 **반대 부호**로 따라간다. 독립 랜덤 금지.
- 눈 saccade: 이산 이벤트. 2~6초 간격, 이동 시간 0.05초 이내, 3~8°.
- blink: 2~6초 랜덤 간격, 닫힘 0.06s / 열림 0.12s.
- 모든 절차적 값은 clamp 범위를 상수로 명시한다.

## 10. 환경/수명주기 함정

- **three 버전 및 호환성 (검증된 사실)**:
  - `@pixiv/three-vrm@3.5.5`의 `peerDependencies`는 three `">=0.137"`이다.
  - `^0.180`은 저장소의 devDependencies(개발용)일 뿐 요구사항이 아니다.
  - 본 프로젝트는 three `0.170.0` 설치 상태이며 호환 범위 내다.
  - **규칙**:
    - three 버전을 올리거나 내리는 변경 금지 (`0.170.0` 고정).
    - `@pixiv/three-vrm/nodes` (TSL/WebGPU 엔트리) import 금지. `WebGLRenderer` 경로만 사용.
    - `@types/three`가 설치돼 있으면 three 0.170 계열과 메이저/마이너가 일치해야 한다. 불일치 시 코드 수정이 아니라 보고만 해라.
- React StrictMode: 이펙트 2회 실행으로 VRM/mixer 중복 생성 주의. 반드시 cleanup 구현.
- HMR: 이전 인스턴스 누수 주의. 정리는 `VRMUtils.deepDispose(vrm.scene)`.
- 로드 최적화: `VRMUtils.removeUnnecessaryVertices` / `removeUnnecessaryJoints`,
  그리고 scene 순회하며 `obj.frustumCulled = false`.
- 탭 백그라운드 복귀: `dt` 클램프 + 스파이크 감지 시 springbone 리셋.
