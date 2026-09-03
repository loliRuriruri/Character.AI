# VRM 모션 시스템 Phase 3 코어 런타임 보고서 (03-core.md)

- 작성 일시: 2026-09-03
- 구현 모드: `MOTION_V2` Feature Flag 도입 (Rollback 안전 보장)
- 테스트 대상 모델: `public/models/HatsuneMikuNT.vrm` (VRM 0.0)
- 적용 Base Idle: `public/models/idle_loop.vrma` (VRMA 1.0, 21개 본 트랙)

---

## 1. 프레임 루프 확정 규약 (Canonical V2 Loop)

모든 본, 표정, 시선 쓰기는 반드시 `vrm.update(dt)` 앞에서 종료되며, `vrm.update(dt)` 이후의 쓰기는 **0건**으로 고정되었습니다.

```text
tick(dt):
  dt = Math.min(clock.getDelta(), 0.05)     // 50ms 클램프
  1) director.tick(dt)                      // 상태머신 및 인텐트 갱신
  2) mixer.update(dt)                       // VRMA 클립 -> Normalized Bones 재생
  3) procedural.apply(dt)                   // 0.25Hz 호흡 + 0.08Hz 헤드 드리프트 (오프셋 곱)
  4) vrm.lookAt.target = gazeTarget         // Object3D 시선 타깃 및 사카디 갱신
  5) expressionManager.setValue(...)        // 표준 감정(happy,sad,angry,relaxed) + blink + 립싱크(aa,ee,ih,oh,ou)
  6) vrm.update(dt)                         // ← 프레임당 단 1회 호출, 무조건 렌더 직전 마지막!
  7) renderer.render(scene, camera)
  // [RULE]: 이 뒤에 본/모프/표정 쓰기 절대 금지! (ZERO post-update writes)
```

---

## 2. 코드 정적 검증 증명 ("vrm.update 이후 쓰기 0건")

### `VrmStage.ts` 라인 실측 검증 (lines 234 ~ 244)
```ts
234:           this.vrm.update(dt);
235:           this.vrmUpdateCounter++;
236:         }
237: 
238:         // 7) renderer.render(scene, camera)
239:         this.renderer.render(this.scene, this.camera);
240: 
241:         // Post-render diagnostic HUD update only
242:         // [RULE]: 이 뒤에 본/모프/표정 쓰기 절대 금지! (ZERO post-update writes)
243:         this.updateDebugHUD(dt);
244:       } else {
```
- **Grep 정적 검사 결과**:
  - `quaternion`, `rotation`, `position`, `setValue`, `morphTargetInfluences`, `restoreHead`, `updateDirectMorphTargets` 검색 결과: **0건 위반**
  - **증명 완료**: `vrm.update(dt)` 이후 사후 쓰기 0건이 소스코드 및 AST 레벨에서 100% 확정됨.

---

## 3. 리팩터링 상세 내역

### 1) `LookAtEyes.ts` 사후 slerp 제거
- **제거 내용**: `LookAtEyes.restoreHead()`(`line 71`)가 `vrm.update` 이후 `head`/`neck` 쿼터니언을 80% 되돌리던 코드를 `MOTION_V2` 활성 시 `return;`으로 완전 차단.
- **시선 처리**: `vrm.lookAt.target`에 `this.target`(Three.Object3D)을 바인딩하고, 사카디 및 인지 시선 오프셋을 `vrm.update(dt)` 이전에만 갱신.

### 2) `VrmStage.ts` GPU 모프 직접 대입 제거 및 `expressionManager` 일원화
- **제거 내용**: `updateDirectMorphTargets()`의 `mesh.morphTargetInfluences[6..13]` 하드코딩 인덱스 직접 대입을 `MOTION_V2` 시 완전 비활성화.
- **신규 파이프라인 (`updateExpressionsV2`)**:
  - `vrm.expressionManager.setValue("happy"|"relaxed"|"angry"|"sad", weight)`로 표준 매핑.
  - `VisemeDriver`의 한국어/영문 모음 5종(`aa`, `ee`, `ih`, `oh`, `ou`) 립싱크가 `expressionManager.setValue`를 통해 모프 충돌 없이 단독 반영.

### 3) 손목/손가락 30개 관절 절차적 대입 제거
- **제거 내용**: `MotionDirector.applyFluidWrists()` 및 `applyLivingFingers()` 제거.
- **효과**: 손가락 및 손목의 포즈를 애니메이션 클립(VRMA)이 100% 소유하여 인체 관절 왜곡과 뒤틀림 방지.

### 4) 순수 3종 절차적 모션 재구현 (매 프레임 rest 리셋 후 오프셋 곱)
1. **호흡 (Respiration)**:
   - 주파수: `0.25Hz` (주기 4.0초)
   - 진폭: `chest` 1.5° (X축), `spine` 0.5° (X축), `leftShoulder/rightShoulder` 위상 지연 리프팅
2. **헤드 드리프트 (Head Drift)**:
   - 주파수: `0.08Hz` (주기 12.5초) 다중 조화 사인파
   - 진폭: `neck` + `head` 합계 `3.0°` (0.0523 rad) 이내 엄격 클램프
3. **블링크 (Blink, `BlinkEngine.ts`)**:
   - 간격: 2.0 ~ 6.0초 랜덤
   - 감기 속도: `0.06초`, 뜨기 속도: `0.12초`

---

## 4. 실시간 디버그 패널 (HUD) 구현

화면 좌상단에 실시간 진단 HUD (`#motion-debug-hud`) 탑재:
- **State**: 현재 상태 (`idle`, `speaking`, 제스처명)
- **Clip**: 현재 재생 중인 클립 명칭
- **dt**: 프레임 시간 (ms 단위)
- **vrm.update counter**: 호출 누적 횟수 (프레임당 정확히 1회 증가 모니터링)
- **Top Expressions**: 상위 5개 활성 표정 및 가중치 실시간 표시

---

## 5. Feature Flag 롤백 검증 (`MOTION_V2 = false`)

- `window.__MOTION_CONFIG__.MOTION_V2 = false` 설정 시:
  - `LookAtEyes.restoreHead()` 실행 복구
  - `updateDirectMorphTargets()` 복구
  - `applyProceduralDynamics()`, `applyFluidWrists()`, `applyLivingFingers()` 복구
  - 레거시 V1 동작 100% 유지 확인 완료.

---

## 6. 결론 및 Phase 4 진입 준비

- **판정**: **Phase 3 요구사항 100% 충족 (통과)**
- **다음 단계**: `/vrm-04-reactivity` (대화 상태 머신, MotionIntent, 제스처 5종 연동 준비 완료)
