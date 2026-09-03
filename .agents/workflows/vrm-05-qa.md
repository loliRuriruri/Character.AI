---
description: VRM 모션 시스템 Phase 5 - QA 매트릭스 실행, 성능 측정, 최종 보고서 작성.
---

# /vrm-05-qa

## Step 1. QA 매트릭스 (브라우저 서브에이전트로 실제 실행, 각 항목 스크린샷/녹화)

| # | 시나리오 | 기대 결과 |
|---|---|---|
| 1 | 로드 후 30초 무입력 | 완전 정지 구간 없음, 떨림 없음 |
| 2 | 짧은 답변("네.") | 과도한 제스처 없음 |
| 3 | 긴 설명 | explain 자연스럽게 실행 |
| 4 | happy 응답 | 표정과 제스처 조화 |
| 5 | surprised 응답 | one-shot 후 부드러운 복귀 |
| 6 | 연속 10회 대화 | 동일 제스처 과도 반복 없음, 무동작 턴 존재 |
| 7 | 제스처 중 TTS | 립싱크 유지 |
| 8 | 제스처 중 blink | blink 유지 |
| 9 | 감정 강한 응답 | 립싱크가 사라지지 않음 (override 확인) |
| 10 | gaze active | 머리/눈 과도하게 꺾이지 않음 |
| 11 | 제스처 종료 | snap 없이 idle 복귀 |
| 12 | VRM 모델 교체 | 동일 VRMA가 2개 이상 모델에서 재생 |
| 13 | VRM 0.x 모델 | 방향/팔 반전 없음 (해당 시) |
| 14 | 탭 백그라운드 → 복귀 | dt 스파이크로 모션 폭주 없음 |
| 15 | LLM intent 파싱 실패 | 채팅 정상, 캐릭터 fallback 동작 |
| 16 | flag OFF | 기존 Chat/TTS/UI 100% 동일 |
| 17 | HMR / 페이지 재진입 | VRM·mixer 중복 생성 없음 |

## Step 2. 성능 측정
FPS, 메인스레드 프레임 타임, mixer.update 시간, vrm.update 시간,
활성 액션 수(누적되는지), 메모리, 애셋 캐시 크기.
가능하면 저사양 프로파일(CPU 4x throttle)에서도 측정한다.

## Step 3. 최종 보고서
`docs/vrm-motion/05-report.md` 를 아래 형식으로 작성한다.

```markdown
# VRM Motion V2 결과
## Root Cause
## 확인한 공식 자료 (URL + 접속일 + 버전)
## 변경 파일
## 제거/비활성화한 legacy 코드
## 새 Architecture
## Known-good VRMA 테스트 결과
## Motion 테스트 결과 (idle / nod / wave / explain / laugh / thinking)
## QA 매트릭스 결과 (17항목 PASS/FAIL + 증거)
## 성능 측정 결과
## 남아있는 문제 (숨기지 말 것)
## 다음 개선 우선순위 3가지
```

## Step 4. 정직성 체크
FAIL 항목을 임시 보정값으로 숨기지 않았는지 스스로 검토한다.
숨긴 것이 있으면 지금 밝힌다. 미해결 항목은 재현 절차와 함께 남긴다.
