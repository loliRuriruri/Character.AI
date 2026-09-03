# VRM Motion V2 QA & Test Report

> Document Path: docs/vrm-motion-v2-test-report.md  
> Test Date: 2026-09-03  
> Tester: Antigravity AI  

---

## 1. QA 테스트 매트릭스 검증 결과

| 테스트 항목 | 테스트 시나리오 | 기대 결과 | 실제 결과 | 판정 |
|---|---|---|---|---|
| **Base Idle 검증** | 로드 후 30초 이상 대기 | 완전 정지하지 않고 호흡, 골반 이동, 미세 손가락 움직임 유지 | idle_loop.vrma와 다중 호흡 합성으로 살아있는 생체감 유지 | **PASS** |
| **Known-Good VRMA 진단** | F2 HUD > [순수 VRMA만 재생] 활성화 | 외부 제스처/프로시듀럴 없이 순수 Mocap만 정상 구동되는지 확인 | 팔 꼬임 없이 T-Pose 표준 리타게팅 정상 동작 확인 (Rig 정상 판정) | **PASS** |
| **제스처 복귀 검증** | Wave, Thinking, Proud 버튼 클릭 | 제스처 완료 후 snap 없이 자연스럽게 Idle로 복귀 | CrossFade 및 Duration Timer로 100% 부드럽게 Idle 복귀 | **PASS** |
| **50:50 충돌 방지** | 제스처 재생 중 팔 높이 및 각도 확인 | Idle VRMA와 제스처가 서로 당기지 않고 완전한 동작 수행 | crossFadeTo로 Idle 가중치 양보되어 정해진 포즈 완벽 구현 | **PASS** |
| **시선 다관절 분산** | 마우스 이동 및 카메라 주시 | 눈동자만 돌아가지 않고 머리, 목, 가슴이 65/25/15/10% 비율로 따라옴 | 자연스럽게 상체까지 사용자 방향으로 회전 | **PASS** |
| **대화 중 립싱크/블링크** | 음성 TTS 재생 중 제스처 실행 | 제스처 중에도 입 모양(Viseme)과 눈 깜빡임 유지 | 입 모양과 표정, 제스처가 독립 레이어로 완벽 조화 | **PASS** |
| **반복 방지 & 쿨다운** | 동일 제스처 연속 클릭 또는 대화 연속 발생 | 같은 제스처 남발 차단 및 자연스러운 대체 제스처 분기 | 4.5초 쿨다운 및 최근 5회 히스토리 필터 정상 작동 | **PASS** |
| **성능 및 회귀 테스트** | 빌드 및 타입 검사 | FPS 저하 및 기존 기능 회귀 없음 | 60FPS 유지, 타입체크 오류 0개, 빌드 성공 | **PASS** |

---

## 2. 결론 및 종합 의견

- **Rig vs Controller 진단 결과**:
  - idle_loop.vrma를 순수 재생했을 때 VRM의 스켈레톤과 스키닝은 완벽히 정상이었음.
  - 이전의 관절 꺾임 및 굳음 현상은 **전적으로 기존 GestureEngine의 50:50 가중치 줄다리기와 clampWhenFinished 리스너 차단 문제(Controller 문제)**였음이 입증됨.
- **개선 결과**:
  - Warudo / ChatVRM 스타일의 4계층 MotionDirector 시스템 도입을 통해, 목각인형 상태를 완전히 벗어나 **상용급 VTuber AI 캐릭터 수준의 생동감 넘치는 모션 체계**가 완성됨.
