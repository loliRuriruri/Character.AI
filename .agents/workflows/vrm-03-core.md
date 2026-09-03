---
description: VRM 모션 시스템 Phase 3 - MotionDirector, Base Idle, crossfade, 절차적 미세 모션, 디버그 패널.
---

# /vrm-03-core

전제: Phase 2가 Case B. `vrm-motion-architecture` + `three-vrm-api-facts` 스킬을 로드한다.
이 단계 목표는 **대화 기능 없이도 캐릭터가 살아 있어 보이는 것**이다.
제스처와 LLM 연동은 이 단계에서 하지 않는다.

## Step 1. 구현 계획 제시
파일 단위 계획을 Implementation Plan으로 제시하고 사용자 승인을 받는다.
승인 전에 코드를 쓰지 마라.

## Step 2. 프레임 루프 단일화
`three-vrm-api-facts` 1항의 구조로 통합한다.
vrm.update 호출 지점을 하나로 만들고, dt 클램프를 넣는다.
기존 다중 update 지점은 제거하되 legacy flag 경로는 보존한다.

## Step 3. MotionDirector 골격
`vrm-motion-architecture`의 소유권 원칙대로 클래스를 만든다.
이 시점에는 idle 재생 + 절차적 오버레이만 구현한다.
dispose / cleanup (StrictMode·HMR 대응)을 처음부터 넣는다.

## Step 4. AnimationRegistry + VRMAClipCache
`vrm-motion-assets` 스킬의 캐시 설계를 따른다.
expression/lookAt 트랙 필터를 클립 생성 파이프라인에 **반드시** 포함한다.

## Step 5. Base Idle + crossfade
idle 클립 1~2개를 로드해 crossFade로 순환시킨다.
`stop()` 사용 금지. 루프 이음매를 눈으로 확인한다.

## Step 6. 절차적 미세 모션
`three-vrm-api-facts` 9항의 수치를 그대로 쓴다.
호흡 / 체중이동 / head drift / blink / saccade.
전부 normalized bone에 곱셈으로 얹는다. 대입 금지.

## Step 7. 디버그 패널
`vrm-motion-architecture`의 디버그 패널 명세대로 구현한다.
레이어를 하나씩 끌 수 있어야 한다. 개발 모드에서만 렌더링한다.

## Step 8. 시각 검증
브라우저 서브에이전트로 **30초 이상 연속 관찰**하고 녹화를 남긴다.
합격 조건: 완전 정지 구간 없음 / 떨림 없음 / 루프 snap 없음 / 머리와 몸통이 상관 있게 움직임.
불합격이면 수치를 조정하되, 조정 근거를 문서에 남긴다.

## Step 9. 회귀 확인
flag OFF 상태에서 기존 채팅·TTS·UI가 그대로 동작하는지 확인한다.
FPS, 프레임 타임, 활성 액션 수를 기록한다.

## Step 10. 종료
`docs/vrm-motion/03-core.md` 작성 후 보고하고 **멈춘다.**
