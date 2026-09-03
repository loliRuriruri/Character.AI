---
name: vrm-motion-assets
description: How to obtain, convert, license, and cache VRMA animation assets for a VRM avatar gesture library. Use when the task requires acquiring idle or gesture animation files, or building the animation registry and clip cache.
---

# 애니메이션 애셋 조달

**이 프로젝트에서 가장 오래 걸리고 가장 자주 실패하는 부분이다.** 코드보다 여기를 먼저 확보하라.

## 조달 경로 (우선순위)

### 1. known-good 테스트용 — VRoid 무료 VRMA
VRoid가 BOOTH에서 VRM Animation(.vrma) 무료 세트를 배포한 적이 있다.
Phase 2의 rig 분리 진단용으로 이걸 쓴다.
**반드시 배포 페이지의 라이선스 조건을 읽고 기록하라.** 상업적 사용 가부가 파일마다 다를 수 있다.

### 2. 제스처 본체 — Mixamo + 공식 리타깃 예제
@pixiv/three-vrm 공식 examples에 `humanoidAnimation` 예제와
Mixamo FBX를 런타임에 VRM humanoid로 리타깃하는 `loadMixamoAnimation.js` 가 있다.
Adobe 계정만 있으면 무료.

쓸 만한 검색어: Waving, Talking, Shrugging, Thinking, Happy Idle, Standing Idle

한계(미리 알고 시작할 것):
- Mixamo는 A-pose 기준이라 클립마다 리타깃 품질 편차가 있다
- 손가락 애니메이션이 부실하다
- 전신 이동 위주라 "서서 대화하는" 제스처 선택지가 좁다
- 결국 상체 위주 몇 개만 골라 쓰게 된다

런타임 FBX 리타깃은 초기 로딩 비용이 있으므로,
**최종적으로는 VRMA로 사전 변환해 정적 애셋화**하는 것을 권장한다.

### 3. BVH 보유 시 — bvh2vrma
VRM 컨소시엄(vrm-c)이 만든 웹 변환기. BVH → 표준 VRMA.

### 4. 직접 제작 — Blender + VRM Add-on
Blender용 VRM Add-on이 VRMA export를 지원한다. 브랜드 고유 모션이 필요할 때.

### 5. DeepMotion 등 유료 mocap
초기 5개 만들자고 도입할 도구가 아니다. 출력물 라이선스가 플랜에 묶여 있다.
1차 범위에서 제외하고, 필요성이 실제로 생기면 그때 검토한다.

## 라이선스 기록 의무

모든 애셋에 대해 `docs/vrm-motion/motion-assets.md` 에 기록한다:

| 파일명 | 출처 URL | 취득일 | 라이선스 | 상업적 사용 | 재배포 | 크레딧 표기 의무 | 용도 |

라이선스가 불명확한 애셋은 **사용하지 말고 사용자에게 보고**한다.

## 클립 제작 기준

나쁜 예: "upperArm만 30도 회전"

좋은 wave 구조 — 다음이 모두 들어가야 한다:
```
spine 살짝 기울기 → chest 회전 → 어깨 올라감 → upperArm 들기
→ 팔꿈치 굽힘 → 손목 방향 → 손 흔들기 → head 미세 반대 회전
```

핵심: **모든 제스처 클립은 풀바디로 만든다.** 상체만 있는 클립을 만들면
mixer가 평가하지 않는 본이 얼어붙거나 idle과 트랙 집합이 어긋나 snap이 난다.
(`three-vrm-api-facts` 6항 참조)

explain은 양팔이 항상 동시에 크게 움직이지 않게 하고, 작은 변형 2개(explain_a/b)를 만들어
반복감을 줄인다.

## AnimationRegistry / 캐시

제스처를 재생할 때마다 네트워크 재요청을 하면 안 된다.

```ts
class VRMAClipCache {
  // key: `${assetId}:${vrmInstanceId}`
  // clip은 VRM 인스턴스마다 다르므로 (normalized bone name 의존) VRM별로 캐시한다
  async getClip(assetId: string, vrm: VRM): Promise<THREE.AnimationClip>;
  preload(assetIds: string[], vrm: VRM): Promise<void>;
  disposeFor(vrmInstanceId: string): void;
}
```

주의: `createVRMAnimationClip` 결과는 **특정 VRM의 normalized bone 노드 이름에 묶인다.**
VRM 인스턴스를 교체하면 클립을 다시 생성해야 한다. 원본 `VRMAnimation` 객체는 재사용 가능하다.

앱 부팅 시 idle + 5개 제스처를 preload하고, 로딩 진행률을 표시한다.
