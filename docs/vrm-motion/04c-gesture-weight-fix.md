# 04c Gesture Weight & Full-Body Track Matching Fix
- 원인 1: UI의 thinking 버튼이 7트랙 V1 폴백 클립을 호출하여 상하체 T-pose 붕괴 발생.
- 원인 2: idle_loop.vrma에 손가락 30개 트랙이 없어 idle 복귀 시 손가락이 T-pose(빳빳함)로 고착.
- 조치 1: idleClip에 자연스러운 30개 손가락 휴식 포즈 트랙을 패딩하여 51트랙 풀바디 일치 (Rule 6).
- 조치 2: thinking -> think 별칭 매핑 및 레거시 제스처의 안전 리다이렉트 구현.
- 조치 3: UI 제스처 드로어 버튼 5종(wave, nod, explain, laugh, think) 정비.
- 실측 1: idle 트랙 52개 확장 완료, thinking 호출 시 51트랙 think 정상 재생 (T-pose 0건).
- 실측 2: idle 복귀 후 손가락 쿼터니언 [0.004, -0.019, -0.131, 0.991]로 자연스러운 휨 유지 (isFlatTPose: false).
- 회귀: 60초 idle head yaw 변화폭 3.61° (±10° 이내 PASS), 전 구간 가중치 합 1.000 유지.
- 상태: T-pose 및 손가락 고착 결함 완벽 해결 완료.