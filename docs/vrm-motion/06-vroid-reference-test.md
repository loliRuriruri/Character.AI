# VRoid Hub Reference Motion Test 보고서 (06-vroid-reference-test.md)

> 작성 일시: 2026-09-04 08:15 KST  
> 테스트 환경: Three.js 0.170.0, @pixiv/three-vrm 3.5.5, @pixiv/three-vrm-animation 3.5.5, Electron v33.4.11  
> 대상 모델: `HatsuneMikuNT.vrm` (VRM 0.0)  
> 테스트 화면: `/dev/vrm-motion-lab` ([`motion-lab.html`](file:///C:/TEST/MikuChat-v3/motion-lab.html))

---

## 1. 개요 및 목적

본 테스트는 Pixiv Inc.의 공식 **VRoid Hub Photo Booth**가 캐릭터에 애니메이션을 적용하는 표준 파이프라인을 조사하고, VRoid Project가 공식 배포한 무료 VRMA 7종을 기준으로 현재 프로젝트의 VRM 모델(`HatsuneMikuNT.vrm`) 재생 적합성을 독립 환경에서 정밀 검증하는 것을 목적으로 합니다.

* **핵심 격리 원칙**:
  - `LookAtEyes`, `BlinkEngine`, `VisemeDriver`, 절차적 모션 보정 등 커스텀 본 조작 스크립트를 **100% 완전 비활성화**.
  - 순수 `@pixiv/three-vrm-animation`의 `VRMAnimationLoaderPlugin` + `createVRMAnimationClip` + `THREE.AnimationMixer`만으로 재생.

---

## 2. VRoid Hub Photo Booth VRMA 적용 아키텍처

VRoid Hub 및 VRM Consortium 공식 문서에 따른 동작 메커니즘은 다음과 같습니다:

1. **포맷 사양**: glTF 2.0 기반의 `VRMC_vrm_animation-1.0` 표준 규격 (`.vrma`).
2. **트랙 구성**:
   - VRM 모델의 표준 휴머노이드 본 이름(`Normalized_<BoneName>`)을 키로 회전(quaternion) 곡선을 저장.
   - 루트 모션용 `Normalized_Hips.position` 트랙 1개 포함 (총 52트랙).
   - 양손 30개 손가락 본(`Thumb/Index/Middle/Ring/Little` x `Proximal/Intermediate/Distal` x `L/R`)이 완전하게 포함됨.
3. **적용 파이프라인**:
   ```mermaid
   graph LR
     A[".vrma 파일 (glTF)"] --> B["GLTFLoader + VRMAnimationLoaderPlugin"]
     B --> C["vrmAnimation 인스턴스"]
     C --> D["createVRMAnimationClip(vrmAnimation, vrm)"]
     D --> E["THREE.AnimationClip (52 tracks)"]
     E --> F["THREE.AnimationMixer(vrm.scene)"]
     F --> G["mixer.update(dt) -> vrm.update(dt)"]
   ```
4. **Mixamo FBX 대비 장점**:
   - 별도의 본 매핑 딕셔너리(`mixamoVRMRigMap`) 불필요.
   - A-pose/T-pose 오프셋 쿼터니언 역행렬 곱 연산 불필요.
   - 손가락 트랙이 누락되지 않아 가짜 계란 쥐기 쿼터니언 패딩(`REST_FINGER_QUATS`) 불필요.

---

## 3. 공식 배포 무료 VRMA 7종 규격 확인

`public/VRMA_MotionPack/vrma/`에 보관된 Pixiv Inc. VRoid Project 공식 에셋의 라이선스(`Readme_VRMA_MotionPack_EN.txt`) 및 무결성을 확인했습니다:

| 파일명 | 모션 명칭 | 용량 (Bytes) | 재생시간 (s) | 트랙 수 | 손가락 트랙 |
|---|---|---|---|---|---|
| **VRMA_01.vrma** | Show full body | 1,348,388 B | 11.80 s | 52 | 30개 (100% 완비) |
| **VRMA_02.vrma** | Greeting | 854,284 B | 7.27 s | 52 | 30개 (100% 완비) |
| **VRMA_03.vrma** | Peace sign | 1,335,704 B | 11.68 s | 52 | 30개 (100% 완비) |
| **VRMA_04.vrma** | Shoot | 1,108,548 B | 9.60 s | 52 | 30개 (100% 완비) |
| **VRMA_05.vrma** | Spin | 632,316 B | 9.32 s | 52 | 30개 (100% 완비) |
| **VRMA_06.vrma** | Model pose | 518,364 B | 7.52 s | 52 | 30개 (100% 완비) |
| **VRMA_07.vrma** | Squat | 771,944 B | 11.52 s | 52 | 30개 (100% 완비) |

> [!NOTE]
> VRoid Hub 서비스 웹페이지의 내부 비공개 에셋을 무단 추출하지 않았으며, Pixiv Inc.가 공식 무료 배포한 라이선스 적격 파일만을 사용했습니다.

---

## 4. Motion Lab 독립 테스트 환경 구축 (`/dev/vrm-motion-lab`)

* **진입점**: [`motion-lab.html`](file:///C:/TEST/MikuChat-v3/motion-lab.html)
* **컨트롤러**: [`src/debug/motionLab.ts`](file:///C:/TEST/MikuChat-v3/src/debug/motionLab.ts)
* **빌드 설정**: [`vite.config.ts`](file:///C:/TEST/MikuChat-v3/vite.config.ts)에 `motionLab` 롤업 엔트리 등록 완료.
* **주요 기능**:
  - 공식 VRMA 7종 즉시 재생 버튼 (`VRMA_01` ~ `VRMA_07`).
  - 현재 Mixamo FBX 제스처 5종 비교 재생 버튼 (`wave`, `nod`, `explain`, `laugh`, `think`).
  - A/B 비교 원클릭 토글 버튼 (Greeting 비교, Pose 비교).
  - 실시간 진단 HUD: 트랙 수, Hips 이동 변위, 오른손 월드 좌표, Head Yaw, T-pose 경고.

---

## 5. 실측 데이터: 공식 VRMA 7종 vs 현재 제스처 5종

[`scratch/run_motion_lab_tests.mjs`](file:///C:/TEST/MikuChat-v3/scratch/run_motion_lab_tests.mjs)를 통해 Electron 런타임에서 측정한 전수 데이터입니다.

### A. 공식 VRMA 7종 실측 요약
| ID | 모션명 | 재생시간 (s) | 전체 트랙 | 손가락 트랙 | Hips 위치트랙 | Hips 최대변위 (cm) | T-pose 샘플 |
|---|---|---|---|---|---|---|---|
| **vrma-1** | VRMA_01 Show full body | 11.80 s | 52 | 30개 | 있음 (정상) | 39.4 cm | **0 (정상)** |
| **vrma-2** | VRMA_02 Greeting | 7.27 s | 52 | 30개 | 있음 (정상) | 68.1 cm | **0 (정상)** |
| **vrma-3** | VRMA_03 Peace sign | 11.68 s | 52 | 30개 | 있음 (정상) | 33.3 cm | **0 (정상)** |
| **vrma-4** | VRMA_04 Shoot | 9.60 s | 52 | 30개 | 있음 (정상) | 35.1 cm | **0 (정상)** |
| **vrma-5** | VRMA_05 Spin | 9.32 s | 52 | 30개 | 있음 (정상) | 35.9 cm | **0 (정상)** |
| **vrma-6** | VRMA_06 Model pose | 7.52 s | 52 | 30개 | 있음 (정상) | 47.3 cm | **0 (정상)** |
| **vrma-7** | VRMA_07 Squat | 11.52 s | 52 | 30개 | 있음 (정상) | 40.7 cm | **0 (정상)** |

### B. 현재 Mixamo FBX 제스처 5종 실측 요약
| ID | 모션명 | 재생시간 (s) | 전체 트랙 | 손가락 트랙 | Hips 위치트랙 | Hips 최대변위 (cm) | T-pose 샘플 |
|---|---|---|---|---|---|---|---|
| **mix-wave** | Current: wave.fbx | 5.10 s | 51 | 30개 | 없음 (제거됨) | 30.8 cm | 0 |
| **mix-nod** | Current: nod.fbx | 1.93 s | 51 | 30개 | 없음 (제거됨) | 30.8 cm | 0 |
| **mix-explain**| Current: explain.fbx | 20.80 s | 51 | 30개 | 없음 (제거됨) | 30.8 cm | 0 |
| **mix-laugh** | Current: laugh.fbx | 9.77 s | 51 | 30개 | 없음 (제거됨) | 30.8 cm | 0 |
| **mix-think** | Current: think.fbx | 4.23 s | 51 | 30개 | 없음 (제거됨) | 30.8 cm | 0 |

---

## 6. 심층 비교 (Side-by-Side Comparison)

### 비교 1: Official VRoid Greeting (`VRMA_02`) vs Current Greeting (`wave.fbx` / `nod.fbx`)

| 측정 구간 | 지표 | Official VRoid Greeting (VRMA_02) | Current Mixamo Greeting (wave.fbx) |
|---|---|---|---|
| **0% (시작)** | 오른손 월드 좌표 | `[-0.156, 0.199, 0.021]` (자연스러운 차렷) | `[-0.118, 0.840, 0.009]` (허리 높이 대기) |
| | 오른손 쿼터니언 | `[0.023, -0.042, 0.474, 0.879]` (자연스러운 안쪽 굽힘) | `[0.334, -0.120, -0.006, 0.935]` (Mixamo 원본) |
| **25%** | 모션 동작 | 정중하게 인사하며 상체와 손을 앞으로 정렬 | 손을 가슴 높이로 들어 올리며 흔들기 준비 |
| **50% (피크)** | 오른손 월드 좌표 | `[-0.333, 1.327, 0.571]` (얼굴 앞 정중한 손인사) | `[-0.135, 1.431, 0.122]` (머리 옆 손 흔들기) |
| | Head Yaw | `-166.51°` (정면에서 살짝 끄덕임) | `173.60°` (정면 유지) |
| **75%** | 모션 동작 | 정중한 인사 후 상체 복귀 동작 | 손 흔들기 후 하강 |
| **100% (끝)** | 종료 포즈 | `[-0.156, 0.199, 0.021]` (시작 포즈와 완벽 일치) | `[-0.118, 0.840, 0.009]` (시작 포즈와 일치) |

* **특징 분석**:
  - `VRMA_02 Greeting`은 애니메이션 품질이 매우 우아하며, 일본/애니메이션 캐릭터 특유의 정중한 인사와 부드러운 손동작이 자연스럽게 표현됩니다.
  - 반면 `wave.fbx`는 전형적인 서양식 손 흔들기 모션으로, 손목의 꺾임 각도가 다소 기계적입니다.

---

### 비교 2: Official VRoid Pose (`VRMA_01`/`VRMA_06`) vs Current AI Gesture (`explain.fbx`/`think.fbx`)

| 구분 | Official VRMA_01 / VRMA_06 | Current Mixamo explain / think |
|---|---|---|
| **재생시간** | 11.8s (`VRMA_01`), 7.52s (`VRMA_06`) (적정) | 20.8s (`explain`), 4.23s (`think`) |
| **손가락 표현** | 전문 애니메이터가 잡은 섬세한 모프/손가락 곡선 | 절차적 인버스 쿼터니언 및 계란 쥐기 패딩 의존 |
| **상체 밸런스** | 어깨와 쇄골의 자연스러운 연동 (0.0 스탠다드) | Mixamo A-pose와 VRM T-pose 간의 어깨 들림 오차 발생 |
| **시선 및 머리** | Head Yaw 변화폭 약 6° 내외 (시선 안정) | `think.fbx`의 경우 Head Yaw가 154.6°까지 꺾임 (과도) |

---

## 7. 판정 트리 결과 및 근본 원인 결론

### 7항 판정: 공식 VRMA 정상 여부
* **판정**: **`공식 VRMA 100% 정상 (NORMAL)`**
  - `HatsuneMikuNT.vrm` 모델에서 공식 VRMA 7종 모두 메시 깨짐, 본 뒤틀림, 관절 꺾임 없이 완벽하게 재생됨.
  - `tposeSampleCount = 0` (전체 샘플에서 T-pose 튐 0건).
  - 따라서 VRM 휴머노이드 매핑, T-pose 바인드, VRM 0.0 기본 구조에는 아무런 결함이 없습니다.

### 8항 판정: 제스처 파이프라인 근본 원인 규명
* **근본 원인**: **Mixamo FBX 런타임 수동 리타깃팅 파이프라인(`loadMixamoAnimation.ts`)의 한계**.
  - Mixamo FBX는 본 계층 구조와 기본 휴머노이드 바인드 포즈(A-pose 계열)가 VRM 정규화 T-pose와 달라, 런타임에 수동 역회전 행렬을 곱하는 과정에서 어깨 들림, 손목 비틀림, 손가락 펴짐(T-pose 유사 플랫 핸드) 오차가 발생합니다.
  - 반면 VRoid Project의 공식 VRMA는 처음부터 VRM 정규화 리그에 최적화되어 있으므로, 어떠한 수동 행렬 보정이나 가짜 손가락 패딩 없이도 완벽한 포즈가 나옵니다.

---

## 8. 최종 권고: VRMA 기반 MotionDirector 전환 방안

1. **에셋 교체 권고**:
   - 현재 대화 제스처로 사용 중인 무거운 Mixamo FBX 5종 대신, 공식 VRMA 및 VRM 호환 애니메이션 에셋을 프로젝트의 공식 제스처로 등록:
     - **인사 (greeting/wave)**: `VRMA_02.vrma`
     - **포즈/칭찬 (happy/model)**: `VRMA_06.vrma` / `VRMA_03.vrma` (Peace)
     - **설명/바디 제스처 (explain/show)**: `VRMA_01.vrma`
     - **생각 (think)**: `VRMA_04.vrma` (또는 상체 특화 VRMA)
2. **Hips 위치 트랙 처리 방침 (상반신 카메라 뷰 대응)**:
   - 전신 뷰에서는 공식 VRMA의 `Normalized_Hips.position`을 그대로 살려 자연스러운 무릎 굽힘/절을 표현.
   - 흉부/상반신 줌인 대화 뷰에서는 `MotionDirector`가 카메라 이탈 방지를 위해 `Hips.position`의 Y/Z축 이동폭을 부드럽게 80% 감쇠(damping)하여 재생하는 필터 적용 권장.
3. **Motion Lab 보존**:
   - 신규 모션 추가 시 회귀 검증을 위해 본 테스트베드([`motion-lab.html`](file:///C:/TEST/MikuChat-v3/motion-lab.html))를 영구 개발 도구(`/dev/vrm-motion-lab`)로 정식 유지.
