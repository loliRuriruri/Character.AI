# VRM Motion Research & Specification Verification Report

> Document Path: docs/vrm-motion-research.md  
> Verification Date: 2026-09-03  
> Target Packages: @pixiv/three-vrm 3.4.4, @pixiv/three-vrm-animation 3.4.4, three 0.170.0  

---

## 1. 공식 문서 및 Specification 검증

### 1.1 VRM Animation (.vrma) Specification
- **참조 URL**:
  - https://vrm.dev/en/vrma/
  - https://github.com/vrm-c/vrm-specification/tree/master/specification/VRMC_vrm_animation-1.0
- **핵심 원리**:
  - VRM Animation은 glTF 2.0 기반의 표준 휴머노이드 모션 파일 규격입니다.
  - T-Pose를 기준으로 정의된 표준 Normalized Humanoid 스켈레톤에 리타게팅되어, 키와 뼈 길이가 다른 어떤 VRM 모델에도 동일한 모션이 왜곡 없이 적용됩니다.
  - Bone Transform뿐 아니라 expression(표정) 및 lookAt(시선 타겟) 트랙을 함께 포함할 수 있습니다.
- **프로젝트 적용 사항**:
  - 기존의 로컬 본 Euler 각도 직접 조작을 지양하고, Base Idle 모션을 순수 표준 .vrma 클립(idle_loop.vrma) 기반으로 AnimationMixer에서 구동합니다.

---

### 1.2 @pixiv/three-vrm & three-vrm-animation Loader Pipeline
- **참조 URL**:
  - https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm-animation/examples/loader-plugin.html
  - https://pixiv.github.io/three-vrm/docs/classes/three-vrm.VRMHumanoid.html
- **공식 권장 로딩 흐름**:
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  const clip = createVRMAnimationClip(vrmAnimations[0], vrm);
  const mixer = new THREE.AnimationMixer(vrm.scene);
  mixer.clipAction(clip).play();
- **프로젝트 적용 사항**:
  - VrmStage.ts에서 위 공식 파이프라인을 100% 준수하여 idle_loop.vrma를 로드하고 createVRMAnimationClip으로 변환하여 MotionDirector에 전달합니다.

---

### 1.3 Normalized Humanoid Bones vs Raw Bones
- **참조 URL**:
  - https://pixiv.github.io/three-vrm/docs/documents/migration-guide-1.0.html
- **핵심 차이점**:
  - getRawBoneNode(): 3D 모델 원본 본 노드. 모델링 프로그램마다 축 방향과 Rest Pose가 달라 임의 회전 시 왜곡 발생.
  - getNormalizedBoneNode(): VRM 1.0 규격에 의해 T-Pose와 축 방향이 표준화된 노드. 모든 VRM 모델에서 일관된 회전 보장.
- **프로젝트 적용 사항**:
  - 모든 본 접근(cacheBones, applyProceduralDynamics, applyFluidWrists, applyLivingFingers)에서 100% vrm.humanoid.getNormalizedBoneNode()만을 사용합니다.

---

### 1.4 Three.js AnimationAction CrossFade
- **참조 URL**:
  - https://threejs.org/docs/pages/AnimationAction.html
- **핵심 원리**:
  - clampWhenFinished = true 상태에서 finished 이벤트를 기다리면 애니메이션이 굳어버리거나 다른 액션과 weight 충돌이 발생.
  - crossFadeTo(targetAction, duration, false)를 호출하면 이전 액션과 신규 액션의 가중치가 부드럽게 교차 페이드(1.0 -> 0.0, 0.0 -> 1.0)되어 관절 꺾임이나 멈춤 현상 해소.
- **프로젝트 적용 사항**:
  - MotionDirector.ts에 crossFadeTo 기반 전환 및 타임아웃 자동 복귀 루틴을 구축했습니다.

---

### 1.5 Warudo & ChatVRM 상용 VTuber 아키텍처
- **참조 URL**:
  - https://docs.warudo.app/docs/assets/character
  - https://github.com/pixiv/ChatVRM
- **핵심 설계**:
  - Base Idle (상시 Mocap 루프)
  - Transient Gesture (가중치 교차 페이드 반응)
  - Multi-Bone Gaze (눈 65%, 머리 25%, 목 15%, 가슴 10% 분산)
  - Procedural Dynamics (호흡, 손가락 캐스케이드, 손목 스프링)
  - SpringBone (최종 프레임 머리카락/치마 자연 물리 연산)
- **프로젝트 적용 사항**:
  - 이 4계층 아키텍처를 MikuChat-v3의 핵심 구조로 채택하여 구현 완료했습니다.
