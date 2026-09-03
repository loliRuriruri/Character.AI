# VRM Motion System 작업 산출물

이 폴더에는 에이전트가 생성한 문서만 둔다. 워크플로 파일을 여기에 두지 말 것.

## 실행 순서

| 순서 | 커맨드 | 산출물 | 게이트 |
|---|---|---|---|
| 0 | `/vrm-00-setup` | 00-env.md | 환경 확인 |
| 1 | `/vrm-01-audit` | 01-audit.md | root cause 한 문장 확정 |
| 2 | `/vrm-02-rigtest` | 02-rigtest.md, motion-assets.md | Case A면 중단 |
| 3 | `/vrm-03-core` | 03-core.md | 30초 관찰 영상 통과 |
| 4 | `/vrm-04-reactivity` | 04-reactivity.md | 제스처 5종 snap 없음 |
| 5 | `/vrm-05-qa` | 05-report.md | QA 17항목 |

## 사용 규칙

- **Phase마다 대화를 새로 시작한다** (`/clear`). 직전 Phase 문서만 읽게 한다.
  한 대화에서 Phase 1~5를 전부 하려고 하면 컨텍스트 오염으로 반드시 실패한다.
- Implementation Plan이 뜨면 그냥 Proceed 하지 말고 코멘트로 범위를 조인다.
- 각 Phase 종료 후 사람이 직접 화면을 본다. 수용 기준이 전부 시각 판정이다.
- Case A(rig 문제) 판정이 나오면 Phase 3 이후를 진행하지 않는다.
