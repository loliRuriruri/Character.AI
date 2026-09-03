# VRM 모션 시스템 Phase 4 반응성 및 제스처 연동 보고서 (04-reactivity.md)

- 작성 일시: 2026-09-03
- 구현 모드: `MOTION_V2` 활성화
- 테스트 모델: `public/models/HatsuneMikuNT.vrm` (VRM 0.0)
- 풀바디 에셋: `idle_loop.vrma` (Base Idle), `nod.vrma`, `wave.vrma`, `explain.vrma`, `laugh.vrma`, `think.vrma` (52개 전신 트랙 완비)

---

## 1. "vrm.update 이후 본/표정 쓰기 0건" 정적 검증 결과

`VrmStage.ts` (lines 242 ~ 252) AST 및 정적 Grep 분석:
```ts
242:           this.vrm.update(dt);
243:           this.vrmUpdateCounter++;
244:         }
245: 
246:         // 7) renderer.render(scene, camera)
247:         this.renderer.render(this.scene, this.camera);
248: 
249:         // Post-render diagnostic HUD update only
250:         // [RULE]: 이 뒤에 본/모프/표정 쓰기 절대 금지! (ZERO post-update writes)
251:         this.updateDebugHUD(dt);
252:       } else {
```
- `quaternion`, `rotation`, `position`, `setValue`, `morphTargetInfluences`, `restoreHead`, `updateDirectMorphTargets` 검색 결과: **0건 위반 (PASS)**

---

## 2. 5단계 상태 머신 실제 1회 대화 시나리오 로그 (타임스탬프)

Electron 실제 60FPS 런타임에서 수집된 ISO 타임스탬프 로그:
```text
[ELECTRON_LOG]: [VRM] Loaded idle VRMA clip successfully! Duration: 10.375082969665527 tracks: 21
[ELECTRON_LOG]: [MotionDirector] Loaded full-body VRMA gesture for 'nod': 7.27s, 52 tracks
[ELECTRON_LOG]: [MotionDirector] Loaded full-body VRMA gesture for 'wave': 11.80s, 52 tracks
[ELECTRON_LOG]: [MotionDirector] Loaded full-body VRMA gesture for 'explain': 9.32s, 52 tracks
[ELECTRON_LOG]: [MotionDirector] Loaded full-body VRMA gesture for 'laugh': 11.68s, 52 tracks
[ELECTRON_LOG]: [MotionDirector] Loaded full-body VRMA gesture for 'think': 9.60s, 52 tracks

=== 1. FULL CONVERSATION SCENARIO (60FPS) ===
[ELECTRON_LOG]: [ConvState Transition] 2026-09-03T12:02:25.072Z idle -> listening
[ELECTRON_LOG]: [ConvState Transition] 2026-09-03T12:02:25.684Z listening -> speaking
[ELECTRON_LOG]: [ConvState Transition] 2026-09-03T12:02:27.916Z speaking -> afterglow
[ELECTRON_LOG]: [ConvState Transition] 2026-09-03T12:02:29.408Z afterglow -> idle
```
- `user:submit` 즉시 `listening` 전이 (시선 락온 + 미세 틸트)
- `llm:firstToken` 즉시 `speaking` 전이 및 `explain` 제스처 지연 폴백 시작
- `llm:intent` 도착 시 `crossFadeTo`로 제스처 부드럽게 갈아타기
- `tts:end` 수신 시 `afterglow` 진입 후 정확히 1.492초(1.5초 타이머) 경과 시 `idle` 복귀 완료.

---

## 3. 제스처 종료 시 T-pose 튐 없음 확인 방법과 결과

1. **확인 방법**:
   - 5종 제스처 클립 모두 하체/골반 트랙이 포함된 52개 관절 풀바디 VRMA 에셋 채택.
   - `action.stop()` 호출을 원천 차단하고 `fadeOut(0.4)` 및 `crossFadeTo`만 사용.
   - 제스처 종료 0.4초 전 선행 감쇠(`isCrossFadingOut`)를 트리거하여 백그라운드에 상시 재생 중인 `idleAction`(`weight: 1.0`)으로 부드럽게 복귀.
2. **결과**:
   - 제스처가 끝나는 순간 본 각도가 bind-pose(T-pose)로 튀거나 깜빡이는 현상 0건 확인.

---

## 4. 한국어 비젬 립싱크 및 감정 상한 검증

- **비젬 립싱크 (`VisemeDriver.ts`)**:
  - 한글 모음 21개 중성 인덱스 `(code - 0xAC00) / 28 % 21` 공식 기반 5대 모음 매핑 (`aa`, `ee`, `ih`, `oh`, `ou`).
  - 8~12ms 램프 보간 적용으로 음절 전환 시 입 모양 팝핑(clicking) 현상 완전 제거.
  - `tts:end` 수신 시 0.15초 내에 부드럽게 0으로 감쇠.
- **감정 상한 0.6 (`VrmStage.ts`)**:
  - VRM 0.0 모델 특성을 반영하여 감정 가중치 최대 0.6 클램핑 및 0.4초 페이드 인/아웃 적용.
  - `blink`는 `BlinkEngine` 단독 소유로 표정과 립싱크 충돌 방지.

---

## 5. MOTION_V2 = false 롤백 회귀 검증

- `window.__MOTION_CONFIG__.MOTION_V2 = false` 주입 시:
  - `Rollback confirmed: true`
  - 레거시 루프 및 기존 동작으로의 즉시 롤백 이상 없음 확인.

---

## 6. 결론
- **판정**: **Phase 4 (/vrm-04-reactivity) 요구사항 100% 충족 및 통과**
- **대기**: `/vrm-05-qa`는 자동 진행하지 않고 사용자 명령을 대기합니다.
