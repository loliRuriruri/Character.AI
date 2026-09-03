---
description: VRM 모션 시스템 Phase 1 - 진단 전용 감사. 코드 수정 없음.
---

# /vrm-01-audit

**이 워크플로에서는 애플리케이션 코드를 수정하지 않는다.**
예외: 진단용 임시 디버그 코드는 허용하되, 반드시 별도 파일에 두고 종료 시 목록을 보고한다.

## Step 1. 환경 인벤토리
`vrm-triage` 스킬을 로드한다.
package.json / lockfile / 실제 import 경로에서 확인:
three, @pixiv/three-vrm, @pixiv/three-vrm-animation, @pixiv/three-vrm-core,
렌더 프레임워크, R3F 사용 여부, WebGL/WebGPU, 로드하는 VRM 파일의 버전(0.x / 1.0).
→ `docs/vrm-motion/00-env.md` 갱신

## Step 2. 로드 경로 추적
VRM 파일 → GLTFLoader → VRMLoaderPlugin → vrm 객체 → scene.add →
컨트롤러 → 프레임 루프 → vrm.update 까지 전체 경로를
**파일:라인 + 함수명**으로 나열한다.

## Step 3. 반응 경로 추적
사용자 전송 → LLM 응답 → 파서 → 감정/제스처 결정 → 컨트롤러 → 본 조작
까지 전체 호출 체인을 추적한다. 타이머와 requestAnimationFrame 내부 절차적 코드도 포함한다.

## Step 4. 트리아지 T1~T4 실행
`vrm-triage` 스킬의 T1~T4를 순서대로 실행한다.
T1 또는 T3에서 실패하면 즉시 멈추고 보고한다. T5는 다음 워크플로에서 한다.

## Step 5. 문서화
`docs/vrm-motion/01-audit.md` 작성:
- 현재 아키텍처 다이어그램 (텍스트)
- 본/표정 쓰기 충돌 표 (T4 결과)
- 업데이트 순서 실측 결과
- root cause 가설 순위 (근거 포함)
- 참조 URL + 접속일
- 삽입한 임시 디버그 코드 목록

## Step 6. 종료
"Phase 1 완료. root cause 가설: <한 문장>. /vrm-02-rigtest 실행 준비됨"
이라고 보고하고 **멈춘다.** 다음 단계로 넘어가지 마라.
