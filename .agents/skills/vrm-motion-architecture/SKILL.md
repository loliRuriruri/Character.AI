---
name: vrm-motion-architecture
description: Target architecture for an AI chat VRM avatar motion system, including MotionDirector ownership, conversation state machine, MotionIntent schema, LLM latency handling, gesture selection rules, and Korean lip sync mapping. Use when designing or implementing the new motion system after triage is complete.
---

# 목표 아키텍처

## 소유권 원칙

아바타의 모든 transform, expression, gaze 쓰기 권한은 **MotionDirector 인스턴스 하나**가 독점한다.

금지되는 구조:
```
ChatComponent  -> leftArm.rotation
TTSComponent   -> head.rotation
EmotionHook    -> expressionManager.setValue
IdleTimer      -> spine.rotation
```

허용되는 구조: 외부는 오직 `director.xxx()` 메서드만 호출한다.

```ts
class MotionDirector {
  // 상태 입력
  setConversationState(s: ConvState): void;
  applyIntent(intent: MotionIntent): void;
  setSpeaking(on: boolean): void;
  setGazeTarget(t: GazeTarget): void;
  setLipSyncSource(src: LipSyncSource | null): void;

  // 내부 전용
  update(dt: number): void;

  // 디버그
  debugPlayClip(id: string): void;
  debugSetLayerEnabled(layer: Layer, on: boolean): void;
  getDebugState(): MotionDebugState;

  dispose(): void;
}
```

## 대화 상태 머신 (MotionIntent와 별개의 1급 개념)

**이게 체감 품질의 절반 이상을 좌우한다.** 제스처 개수보다 전환 타이밍이 중요하다.

```
idle ──(사용자 입력 포커스/타이핑)──> listening
listening ──(전송)──> thinking
thinking ──(첫 토큰 도착)──> speaking
speaking ──(TTS 종료)──> afterglow (0.5~1.5s)
afterglow ──> idle
```

각 전환에 짧은 반응을 건다:
- → listening: 카메라로 시선 복귀 + 아주 작은 끄덕임
- → thinking: 시선 살짝 이탈(위/옆) + 머리 미세 기울임 + 몸 일시 정지감
- → speaking: 시선 카메라 복귀 + 어깨 정돈. **첫 토큰 도착 즉시 실행한다.**
- → afterglow: 짧은 호흡, 표정 weight 완만한 감쇠
- → idle: base idle로 crossfade

LLM intent가 늦거나 실패해도 이 상태 머신은 독립적으로 동작해야 한다.

## MotionIntent 스키마

LLM은 연출 의도만 만든다. 본 각도는 절대 생성하지 않는다.

```ts
type Emotion = 'neutral'|'happy'|'relaxed'|'sad'|'angry'|'surprised'|'embarrassed'|'thinking';
type Gesture = 'none'|'nod'|'wave'|'explain'|'laugh'|'thinking';   // 1차는 5종+none만
type GazeTarget = 'camera'|'left'|'right'|'down'|'away';

interface MotionIntent {
  emotion: Emotion;
  emotionIntensity: number;   // 0..1
  gesture: Gesture;
  gestureIntensity: number;   // 0..1
  gazeTarget: GazeTarget;
  energy: number;             // 0..1
}
```

런타임 검증 필수. 알 수 없는 값이 오면 조용히 fallback:
`{ emotion:'neutral', emotionIntensity:0.3, gesture:'none', gestureIntensity:0, gazeTarget:'camera', energy:0.4 }`

## LLM 레이턴시 문제 (반드시 처리)

응답 **끝**에 intent를 붙이면 캐릭터가 말을 다 마친 뒤에 손을 흔든다.

채택할 방식: **intent를 응답 맨 앞에 생성**시키고 스트림 첫 청크에서 파싱한다.
- 사용자에게 JSON이 노출되지 않도록 파싱 후 스트림에서 제거한다.
- 파싱 실패해도 스트림은 정상 진행되어야 한다.
- 그와 별개로 **첫 청크 도착 즉시 speaking 상태로 전환**한다. intent를 기다리지 않는다.

대안(문장 단위 세그먼트 + TTS 청크 동기화)은 1차 범위에서 제외한다.

## 제스처 선택은 LLM만 믿지 않는다

`director` 내부 로컬 룰로 보정한다:
- 쿨다운: 제스처별 `cooldownMs` (wave는 길게, nod은 짧게)
- 최근 이력: 직전 2회와 동일 제스처 회피, 변형(explain_a/explain_b) 순환
- 응답 길이: 짧은 응답이면 큰 제스처 억제, nod 정도로 축소
- 에너지 임계: `energy < 0.3` 이면 제스처 생략
- **의도적 무동작**: 전체의 30~40%는 제스처 없이 idle 변형만. 매 응답 제스처 금지.

## 제스처 메타데이터

```ts
interface GestureConfig {
  id: string;
  clipUrl: string;
  fadeIn: number;        // 0.20~0.40
  fadeOut: number;       // 0.25~0.50
  speed: number;
  cooldownMs: number;
  emotionTags: Emotion[];
  energyMin: number;
  energyMax: number;
  allowWhileSpeaking: boolean;
  priority: number;
}
```

값을 코드에 흩뿌리지 말고 단일 설정 파일에 모은다.

## 한국어 립싱크

TTS 제공자별 우선순위:
1. viseme/타임스탬프 제공 (예: Azure viseme 이벤트, ElevenLabs character alignment)
   → 그대로 사용. viseme을 VRM 5개(aa/ih/ou/ee/oh)로 매핑.
2. 타임스탬프 없음 (예: OpenAI TTS)
   → WebAudio AnalyserNode 진폭 + **한글 자모 분해** 조합.

한글 트릭 (영어권 앱보다 오히려 잘 나온다):
```ts
// 음절에서 중성(모음) 인덱스 추출
const jung = Math.floor((code - 0xAC00) / 28) % 21;
// ㅏㅑ→aa  ㅣㅢ→ih  ㅜㅠㅡ→ou  ㅔㅐㅖㅒ→ee  ㅗㅛ→oh
```
텍스트 길이와 오디오 길이로 타이밍을 배분하고, 진폭으로 개폐 **크기**를 조절한다.
자음/받침 구간은 입을 살짝 닫는다.

립싱크 값은 항상 `vrm.update()` 이전에 `setValue`로 쓴다.
발화 중 emotion weight 제한은 `three-vrm-api-facts` 8항 참조.

## 디버그 패널 (개발 모드 전용)

표시: VRM 버전 / 현재 대화 상태 / 현재 idle / 현재 gesture / gesture weight·elapsed /
emotion + weight / speaking / gaze target / lipsync active / 활성 mixer action 수 / dt / FPS /
각 preset expression의 override 설정

버튼: known-good VRMA 재생 / idle / 각 제스처 재생 / resetNormalizedPose /
Procedural OFF / LookAt OFF / LipSync OFF / Expression OFF / Legacy 경로 토글

레이어를 하나씩 꺼가며 범인을 특정할 수 있어야 한다. 이게 디버그 패널의 유일한 존재 이유다.
