---
description: VRM 모션 시스템 Phase 4 - 대화 상태 머신, MotionIntent, 제스처 5종, 표정, LookAt, 립싱크.
---

# /vrm-04-reactivity

전제: Phase 3 완료 및 시각 검증 통과.
`vrm-motion-architecture` 스킬을 로드한다. 반드시 아래 순서대로, 각 Step마다 확인 후 진행한다.

## Step 1. 대화 상태 머신 (제스처보다 먼저)
idle / listening / thinking / speaking / afterglow 를 구현하고
각 전환에 짧은 반응을 건다. **첫 토큰 도착 즉시 speaking 전환**을 반드시 넣는다.
이 단계만으로도 체감이 크게 달라져야 한다. 여기서 한 번 확인하고 보고한다.

## Step 2. 제스처 애셋 5종 확보
`vrm-motion-assets` 스킬 참조. nod / wave / explain / laugh / thinking.
전부 **풀바디 클립**. 라이선스 표 갱신. 애셋 없이 코드부터 쓰지 마라.

## Step 3. 제스처 재생 + 복귀
LoopOnce + clampWhenFinished + finished 이벤트에서 crossFade 복귀.
제스처별 fadeIn/fadeOut/speed/cooldown을 설정 파일로 분리한다.
디버그 패널 버튼으로 5종을 하나씩 눈으로 확인한다. snap이 있으면 다음으로 넘어가지 마라.

## Step 4. MotionIntent 스키마 + 검증
타입 정의, 런타임 validator, fallback 구현. 잘못된 값에 절대 throw하지 않는다.

## Step 5. LLM 연동
intent를 응답 **맨 앞**에 생성하도록 프롬프트 수정.
스트림 첫 청크에서 파싱하고 사용자 노출 텍스트에서 제거한다.
파싱 실패해도 채팅은 정상 동작해야 한다. 이 실패 케이스를 반드시 테스트한다.

## Step 6. 로컬 룰 보정
쿨다운 / 최근 이력 / 응답 길이 / 에너지 임계 / 의도적 무동작 30~40%.
`vrm-motion-architecture` 참조.

## Step 7. Expression 레이어
감정 페이드 in/out. 0↔1 즉시 전환 금지.
로드 시 각 preset의 overrideMouth/Blink/LookAt 설정을 읽어 디버그 패널에 표시한다.

## Step 8. LookAt 레이어
gaze target + saccade. 애니메이션 클립과 독립. 목이 과하게 꺾이지 않도록 각도 제한.

## Step 9. LipSync 통합
현재 TTS가 viseme/타임스탬프를 제공하는지 **먼저 확인하고 결과를 보고**한 뒤 방식을 정한다.
없으면 한글 자모 분해 + 진폭 방식. `vrm-motion-architecture` 참조.
발화 중 emotion weight 제한(0.5~0.6)을 적용한다.

## Step 10. 종료
`docs/vrm-motion/04-reactivity.md` 작성 후 보고하고 멈춘다. 이어서 `/vrm-05-qa`.
