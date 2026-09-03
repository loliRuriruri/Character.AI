# VRM 모션 시스템 Phase 1 감사 보고서 (01-audit.md)

- 작성 일시: 2026-09-03
- 대상 저장소: `C:\TEST\MikuChat-v3`
- 감사 모드: 읽기 전용 (소스 코드 변경 0줄)

---

## 1. 필수 조사 항목 실측 결과

### 1) `vrm.update(delta)` 호출 지점 및 실행 횟수
- **호출 지점**: `src/character/VrmStage.ts:222` (`this.vrm?.update(dt);`)
- **실행 횟수 결론**: 렌더 루프(`requestAnimationFrame`) 1틱당 **정확히 1회** 호출됨. (중복 호출 없음, 정상)

---

### 2) VRM 본(bone) / Expression / LookAt 쓰기 코드 위치 및 소유권 충돌 분석

#### A. Humanoid Bone 쓰기 코드
| 파일:라인 | 메서드 / 위치 | 대상 본 | 쓰기 방식 | 소유권 충돌 분석 |
| :--- | :--- | :--- | :--- | :--- |
| `src/character/MotionDirector.ts:202` | `update()` | 전신 Normalized Bones | `AnimationMixer.update(delta)` | Base Idle(VRMA) 및 제스처 클립의 키프레임 트랙 재생 |
| `src/character/MotionDirector.ts:265-266` | `applyProceduralDynamics()` | `chest` | `quaternion.multiply(...)` | Mixer 실행 직후 절차적 호흡 각도 곱셈 |
| `src/character/MotionDirector.ts:271-272` | `applyProceduralDynamics()` | `neck` | `quaternion.multiply(...)` | Mixer 실행 직후 절차적 목 각도 곱셈 |
| `src/character/MotionDirector.ts:277-278` | `applyProceduralDynamics()` | `hips` | `quaternion.multiply(...)` | Mixer 실행 직후 골반 흔들림(sway) 각도 곱셈 |
| `src/character/MotionDirector.ts:338-339` | `applyFluidWrists()` | `leftHand`, `rightHand` | `quaternion.slerp(...)` | Mixer 실행 직후 손목 목표각도로 slerp (제스처 키프레임과 경합) |
| `src/character/MotionDirector.ts:384-394, 405-414` | `applyLivingFingers()` | 양손 30개 손가락 본 | `quaternion.slerp(...)` | Mixer 실행 직후 손가락 30개 관절 강제 slerp |
| **`src/character/LookAtEyes.ts:71-72`** | **`restoreHead()`** | **`head`, `neck`** | **`quaternion.slerp(..., 0.80)`** | **[치명적 충돌 1]** `vrm.update(dt)` 실행 직후(`VrmStage.ts:223`), `vrm.lookAt` 및 Mixer가 계산한 머리/목 회전을 사후에 강제로 80% 되돌림 (프레임 순서 위반 및 부자연스러운 떨림/꺾임 유발) |

#### B. LookAt 쓰기 코드
| 파일:라인 | 위치 | 대상 | 동작 | 충돌 분석 |
| :--- | :--- | :--- | :--- | :--- |
| `src/character/LookAtEyes.ts:28` | `constructor` | `vrm.lookAt.target` | `this.target` 객체 지정 | 정상 (단일 타깃 지정) |
| `src/character/LookAtEyes.ts:98-101` | `update()` | `this.target.position` | 카메라 위치 + saccade + cognitive 오프셋 계산 | 정상 |
| `src/character/LookAtEyes.ts:54-59` | `captureHead()` | `head`, `neck` | `vrm.update` 이전 본 쿼터니언 스냅샷 백업 | 사후 `restoreHead`를 위한 비정상 우회 구조 |

#### C. Expression / MorphTarget 쓰기 코드
| 파일:라인 | 메서드 / 위치 | 대상 | 쓰기 방식 | 충돌 분석 |
| :--- | :--- | :--- | :--- | :--- |
| `src/character/BlinkEngine.ts:24, 52` | `update()` | `blink` | `em.setValue("blink", weight)` | `expressionManager` 정상 사용 |
| `src/character/VisemeDriver.ts:42, 48` | `update()`, `clear()` | `aa, ee, ih, oh, ou` | `em.setValue(name, weight)` | `expressionManager` 정상 사용 |
| **`src/character/VrmStage.ts:257-274`** | **`updateDirectMorphTargets()`** | **`morphTargetInfluences[6..13]`** | **GPU SkinnedMesh morph 배열에 직접 대입** | **[치명적 충돌 2]** `vrm.expressionManager`를 완전히 우회하고 `vrm.update(dt)` 이후(`line 226`)에 하드코딩 인덱스(`[6] 입, [12] 눈웃음, [9] 눈썹` 등)를 강제 덮어씀. 이로 인해 `VisemeDriver`의 입 모양과 `[6] ワ`가 충돌하여 입 왜곡 발생, 타 모델 호환 불가 |

---

### 3) VRM 로드 경로 전체 시퀀스
1. **이전 인스턴스 정리 (`src/character/VrmStage.ts:71-80`)**:
   - `this.scene.remove(this.vrm.scene)`
   - `VRMUtils.deepDispose(this.vrm.scene)`
   - 관련 서브시스템 및 참조 해제
2. **GLTFLoader 생성 및 플러그인 등록 (`src/character/VrmStage.ts:81-83`)**:
   - `const loader = new GLTFLoader();`
   - `loader.register((parser) => new VRMLoaderPlugin(parser));`
   - `loader.register((parser) => new VRMAnimationLoaderPlugin(parser));`
3. **VRM 파싱 및 생성 (`src/character/VrmStage.ts:85-86`)**:
   - `const gltf = await loader.loadAsync(modelUrl);`
   - `const vrm = gltf.userData.vrm as VRM;`
4. **0.x 보정 및 버텍스 최적화 (`src/character/VrmStage.ts:87-88`)**:
   - `VRMUtils.removeUnnecessaryVertices(gltf.scene);`
   - `VRMUtils.rotateVRM0(vrm);`
5. **SkinnedMesh 수집 및 Z-Fighting 오프셋 보정 (`src/character/VrmStage.ts:90-125`)**:
   - `vrm.scene.traverse(...)`로 `SkinnedMesh` 배열 수집 및 eye/transparent polygonOffset 설정
6. **VRMA 클립 로드 (`src/character/VrmStage.ts:128-141`)**:
   - `loader.loadAsync(idleUrl)` -> `createVRMAnimationClip(vrmAnimations[0], vrm)`
   - *(현재 누락: LookAtQuaternionProxy 등록 없음, VRMA expression/lookAt 트랙 필터링 없음)*
7. **Scene 추가 및 컨트롤러 인스턴스화 (`src/character/VrmStage.ts:143-149`)**:
   - `this.scene.add(vrm.scene);`
   - `this.motion = new MotionDirector(vrm, idleClip);`
   - `this.look = new LookAtEyes(vrm, this.camera);`
   - `this.blink = new BlinkEngine(vrm, ...);`
   - `this.viseme = new VisemeDriver(vrm);`
8. **카메라 피팅 및 렌더 루프 시작 (`src/character/VrmStage.ts:150-151`)**:
   - `this.frameModel(vrm);`
   - `this.loop();`

---

### 4) 기존 애니메이션 구현 방식
- **구현 방식**: `AnimationMixer` + **매 프레임 절차적 직접 조작/덮어쓰기 혼용 (하이브리드)**
  - `MotionDirector` 내부에서 `AnimationMixer`를 구동하여 Base Idle VRMA 및 하드코딩 오일러 키프레임 제스처 클립(`talk`, `wave`, `thinking` 등)을 재생.
  - 동시에 Mixer 재생 직후 `chest`, `neck`, `hips`에 쿼터니언 곱셈, `hands` 및 30개 손가락 관절에 `.slerp()` 강제 대입.
  - `vrm.update()` 직후 `LookAtEyes`에서 `head`, `neck` 본 쿼터니언을 `.slerp()`로 사후 강제 덮어쓰기.
  - `GestureEngine.ts`는 과거 사용되던 미사용 레거시 코드로 방치되어 있음.

---

### 5) 렌더 루프 위치 및 Delta 계산 방식
- **위치**: `src/character/VrmStage.ts:203-232` (`private loop = (): void => { ... }`)
- **프레임 트리거**: `requestAnimationFrame(this.loop)`
- **Delta 계산**:
  - `const dt = Math.min(0.05, this.clock.getDelta());`
  - **Clamp 여부**: **적용됨** (최대 0.05초 / 50ms로 상한 제한).

---

### 6) VRM 모델의 Meta 버전 확인 방법 및 현재 테스트 모델 값
- **확인 방법**:
  - 런타임: `vrm.meta.metaVersion` 프로퍼티 (`'0'` = VRM 0.x, `'1'` = VRM 1.0)
  - 파일 직접 검사: `.vrm` 파일의 GLB JSON 청크 내 `extensions.VRM` vs `extensions.VRMC_vrm` 확인
- **현재 테스트 모델 값**:
  - 모델 경로: `public/models/HatsuneMikuNT.vrm`
  - 확인 결과: `specVersion: "0.0"`, `title: "止丸式初音ミクNT"`
  - Meta 버전: **`VRM 0.0` (0.x 계열)**
  - 따라서 VRM0 모델 180도 회전(`rotateVRM0`) 및 `createVRMAnimationClip` 시의 축 부호 반전 보정이 적용됨.

---

## 2. 현재 런타임 업데이트 순서 실측 (AS-IS)

```
[Frame Start]
  dt = Math.min(0.05, clock.getDelta())
  │
  ├─ 1. MotionDirector.update(dt)
  │    ├─ mixer.update(dt) (Base Idle + Gesture 클립 평가 -> Normalized 본에 기록)
  │    ├─ applyProceduralDynamics (chest, neck, hips 쿼터니언 multiply)
  │    ├─ applyFluidWrists (lHand, rHand 쿼터니언 slerp)
  │    └─ applyLivingFingers (손가락 30개 관절 쿼터니언 slerp)
  │
  ├─ 2. LookAtEyes.captureHead() (head, neck 현재 쿼터니언 임시 백업)
  ├─ 3. LookAtEyes.update(dt) (target.position 오프셋 갱신)
  ├─ 4. BlinkEngine.update(dt) (em.setValue('blink', w))
  ├─ 5. VisemeDriver.update(dt) (em.setValue('aa'..'ou', w))
  │
  ├─ 6. vrm.update(dt) (VRM 1회 갱신: humanoid normalized->raw 동기화, lookAt 계산, springbone 물리)
  │
  ├─ 7. LookAtEyes.restoreHead()  <-- [위반] vrm.update 이후 head/neck quaternion 80% 강제 slerp
  ├─ 8. VrmStage.updateDirectMorphTargets(dt)  <-- [위반] vrm.update 이후 mesh.morphTargetInfluences 직접 덮어쓰기
  │
  └─ 9. renderer.render(scene, camera)
[Frame End]
```

### 목표 런타임 업데이트 순서 (TO-BE 황금 규약)
```text
tick(dt):
  dt = Math.min(clock.getDelta(), 0.05)
  1) director.tick(dt)                      // 상태머신 / 인텐트 소비
  2) mixer.update(dt)                       // VRMA·제스처 → normalized bone (절대값)
  3) procedural.apply(dt)                   // normalized bone에 오프셋 곱 (호흡/스웨이/헤드드리프트)
  4) vrm.lookAt.target = gazeTarget         // head/neck 직접 회전 금지
  5) expressionManager.setValue(...)        // viseme + emotion + blink
  6) vrm.update(dt)                         // ← 유일한 호출, 무조건 마지막
  7) renderer.render(scene, camera)
  // 이 뒤에 본/모프/표정 쓰기 절대 금지
```

---

## 3. Root Cause 가설 순위 및 판정

1. **1순위 (가장 심각): `vrm.update()` 사후 본/모프 강제 조작으로 인한 파이프라인 파괴**
   - 근거: `LookAtEyes.restoreHead()`(`line 223`)가 `vrm.update()` 이후에 실행되어 머리와 목의 정규화 및 스프링본 상태를 뒤흔들고, `VrmStage.updateDirectMorphTargets()`(`line 226`)가 GPU 버퍼를 직접 덮어써서 립싱크 및 표정 매니저 규칙을 무력화함.
2. **2순위: 제스처 종료 시점의 부자연스러운 처리 및 합성 애니메이션의 관절 각도 결함**
   - 근거: `MotionDirector.buildFullBodyClips()`에서 생성되는 제스처 클립들이 인체 운동학적 연속성 없이 특정 본(upperArm 등)에 임의의 오일러 각도를 주입하고 있으며, 제스처 만료 시 잔여 액션 클램프/페이드아웃 타이밍이 불안정함.
3. **3순위: VRMA 애셋 내 불필요한 트랙(LookAt/Expression) 미필터링**
   - 근거: `idle_loop.vrma` 로드 시 `createVRMAnimationClip` 결과에서 표정 및 시선 트랙을 필터링하지 않아 립싱크 및 LookAt 시스템과의 잠재적 트랙 경합 가능성이 상존함.

---

## 4. 결론 및 다음 단계 준비

- **Root Cause 한 문장 요약**:
  > "프레임 루프에서 `vrm.update()` 호출 이후 `head/neck` 본과 GPU `morphTargetInfluences`를 사후에 직접 덮어쓰고, `MotionDirector`가 코드 기반 불완전 합성 클립과 절차적 본 대입을 혼용하여 애니메이션 상태 누수와 관절 뒤틀림이 발생하고 있다."
- **다음 단계**: `/vrm-02-rigtest` (known-good VRMA 격리 테스트를 통해 rig 문제와 컨트롤러 문제 분리 검증 준비 완료)
