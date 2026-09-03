# 이번 프로젝트의 목표와 범위

## 목표 (한 문장)
AI 캐릭터챗의 VRM 아바타가 대기 중에도 살아 있고, 말할 때 몸을 자연스럽게 사용하며,
표정·시선·입·제스처가 충돌 없이 조화되고, VRM 모델을 교체해도 동작하는
재사용 가능한 모션 시스템을 만든다.

"팔을 더 높이 올리는 것"은 목표가 아니다.

## 이번 범위에 포함
- 현재 모션 코드 감사 및 root cause 확정
- known-good VRMA 재생 테스트 (rig vs 컨트롤러 분리 진단)
- MotionDirector 중앙 컨트롤러
- Base Idle + crossfade
- 절차적 미세 모션 (호흡 / sway / head drift / blink / saccade)
- 대화 상태 머신 (idle / listening / thinking / speaking / afterglow)
- MotionIntent 스키마 + 로컬 룰 보정
- 제스처 5종 (nod, wave, explain, laugh, thinking)
- Expression 페이드 + LookAt 분리
- 디버그 패널

## 이번 범위에서 제외 (요청받아도 하지 말 것)
- IK (CCDIK, Two Bone IK) — 기본 FK/VRMA가 완전히 안정된 뒤 별도 작업
- Unity 스타일 Avatar Mask / 본 마스킹 레이어 — 대신 풀바디 클립 + additive 오버레이 사용
- 제스처 15종 전체 라이브러리
- 실제 face tracking / 웹캠
- three.js 또는 three-vrm 버전 업그레이드
- 렌더링/셰이더/포스트프로세싱 개선
- 채팅 UI 리디자인

범위 밖 작업이 필요하다고 판단되면 코드를 쓰지 말고 사용자에게 제안만 하라.

## 아키텍처 레이어 (이 순서를 지킨다)
```
Layer 0  Base Idle          항상 살아있음, 절대 꺼지지 않음
Layer 1  Conversational     listening / talking 변형
Layer 2  Transient Gesture  2~5초 one-shot, crossfade로 복귀
Layer 3  Expression         감정, 페이드 in/out
Layer 4  LookAt             gaze + saccade
Layer 5  LipSync            TTS 연동
Layer 6  (제외) IK
Layer 7  SpringBone         vrm.update가 마지막에 처리
```

## 완료 기준 (시각 판정)
- 30초 대기 시 캐릭터가 완전히 정지하지 않는다
- 팔 제스처 시 어깨/상체가 함께 움직인다
- 팔꿈치가 몸 안쪽/뒤쪽으로 뒤집히지 않는다
- 제스처 시작/종료에 snap이 없다
- 말하는 동안 몸이 마네킹처럼 굳지 않는다
- 표정이 0↔1로 튀지 않는다
- 감정 표현 때문에 립싱크가 사라지지 않는다
- 기존 Chat / TTS / UI 회귀 없음
