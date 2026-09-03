---
description: VRM 모션 시스템 Phase 2 - known-good VRMA로 rig와 컨트롤러 분리 진단.
---

# /vrm-02-rigtest

전제: `/vrm-01-audit` 완료. `docs/vrm-motion/01-audit.md` 를 먼저 읽는다.

## Step 1. 애셋 확보
`vrm-motion-assets` 스킬 참조. known-good .vrma 파일 1개를 확보하고
출처/라이선스를 `docs/vrm-motion/motion-assets.md` 에 기록한다.
애셋을 구할 수 없으면 코드를 쓰지 말고 사용자에게 요청하라.

## Step 2. 격리된 테스트 화면
기존 채팅 화면을 건드리지 말고 **별도 라우트 또는 개발 전용 패널**을 만든다.
- 커스텀 모션 컨트롤러 완전 비활성화
- `three-vrm-api-facts` 스킬 1~4항을 정확히 따른다
  (프록시 이름 지정 → scene 추가 → 클립 생성 → expression/lookAt 트랙 필터 → mixer)
- dt 클램프 적용
- vrm.update 호출 카운터 표시

## Step 3. 시각 검증
브라우저 서브에이전트로 실제 재생을 확인하고 스크린샷/녹화를 남긴다.
확인 항목: 팔 궤적 / 어깨 연동 / 팔꿈치 방향 / 척추 연동 / 루프 이음매 /
전체 방향(뒤돌지 않는지) / 손가락.

## Step 4. 판정
- **Case A (VRMA도 이상)**: rig 문제. `docs/vrm-motion/02-rigtest.md` 에
  구체적 증상과 의심 지점을 기록하고 **여기서 전체 작업을 중단**한 뒤 사용자에게 보고한다.
  모션 아키텍처 리팩터링을 시작하지 마라.
- **Case B (VRMA 정상)**: 컨트롤러가 원인 확정. Step 5로.

## Step 5. Feature flag 설계
신규 경로를 감쌀 flag를 정의한다 (예: `VITE_VRM_MOTION_V2`).
- OFF: 기존 동작 100% 동일
- ON: legacy 본 조작 코드가 **전혀 실행되지 않음**
동시 실행 가능성이 있는 지점을 찾아 명시적으로 차단한다.

## Step 6. 종료
`docs/vrm-motion/02-rigtest.md` 작성 후
"Phase 2 완료. 판정: Case A/B. /vrm-03-core 실행 준비됨" 보고 후 **멈춘다.**
