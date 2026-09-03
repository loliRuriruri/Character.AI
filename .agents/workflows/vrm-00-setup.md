---
description: VRM 모션 작업 Phase 0 - 환경 검증 및 준비 상태 확인. 코드 수정 없음.
---

# /vrm-00-setup

이 워크플로는 본 작업을 시작하기 전 **환경이 준비됐는지만** 확인한다.
애플리케이션 코드를 수정하지 않는다.

## Step 1. 규칙/스킬 로드 확인
다음이 모두 존재하고 인식되는지 확인하고 보고한다.
- .agents/rules/00-guardrails.md (Always On)
- .agents/rules/10-vrm-motion-scope.md (Always On)
- 스킬 4개: three-vrm-api-facts, vrm-triage, vrm-motion-architecture, vrm-motion-assets
- 워크플로 6개: /vrm-00-setup ~ /vrm-05-qa

하나라도 없으면 여기서 멈추고 사용자에게 알린다.

## Step 2. 패키지 버전 인벤토리
package.json 과 lockfile 에서 실제 설치 버전을 읽는다.
- three
- @pixiv/three-vrm
- @pixiv/three-vrm-core
- @pixiv/three-vrm-animation (미설치일 수 있음 — 설치하지 말고 보고만)
- 렌더 프레임워크 (React / Next / Vite / R3F 등)

three-vrm 이 3.x 가 아니면 `three-vrm-api-facts` 스킬 내용이 다를 수 있으므로
node_modules 의 실제 소스를 확인해야 한다고 보고한다.

**설치, 업그레이드, 다운그레이드를 절대 하지 마라.**

## Step 3. 실행 가능 여부 확인
개발 서버를 실행하고 VRM 아바타가 화면에 렌더링되는지 확인한다.
브라우저 서브에이전트로 스크린샷 1장을 남긴다.
실행이 안 되면 원인만 보고하고 멈춘다.

## Step 4. 기록
`docs/vrm-motion/00-env.md` 에 위 결과를 정리한다.
확인한 URL이 있으면 접속일과 함께 기록한다.

## Step 5. 종료
"Phase 0 완료. /vrm-01-audit 실행 준비됨" 이라고 보고하고 **멈춘다.**
