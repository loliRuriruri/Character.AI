# MikuChat Character Core Plan
> **문서 버전:** 1.0.0  
> **상태:** 조사·비교·설계 완료 (구현 대기 / No Code Changes)  
> **기준 저장소:** `C:\TEST\MikuChat-v3`  
> **참고 프로젝트:** `furabyss/FocusAbove` (MIT License)

---

## 1. 현재 MikuChat 구조

현재 MikuChat-v3 저장소의 핵심 파이프라인은 Electron 메인 프로세스와 3개의 독립 렌더러 창(캐릭터 3D 스테이지, 투명 채팅 오버레이, 설정창)으로 구성되어 있습니다. 실제 파일 및 심볼 기준의 조사 결과는 다음과 같습니다.

### 1.1 프롬프트 조립 및 주입 경로
- **정의 위치:** [`src/shared/persona.ts`](file:///C:/TEST/MikuChat-v3/src/shared/persona.ts)
  - `MIKU_FREE_PROMPT`: 한국어 구어체, 미쿠 캐릭터 성격, 1행 감정 태그(`[[emotion:...]]`), 문장 부호 규칙, 마크다운 금지를 포함한 단일 하드코딩 문자열(46 LOC).
  - `MIKU_TUTOR_PROMPT`: 일본어 튜터 역할, 4지선다 퀴즈 줄바꿈 규칙, SRS 문법/단어 추출 형식을 포함한 단일 문자열.
- **조립 및 전송 위치:** [`electron/main.ts`](file:///C:/TEST/MikuChat-v3/electron/main.ts#L476-L484)
  ```ts
  const activePrompt = settings.chatMode === "tutor" ? MIKU_TUTOR_PROMPT : MIKU_FREE_PROMPT;
  if (history.length === 0 || history[0].role !== "system" || history[0].content !== activePrompt) {
    history = [{ role: "system", content: activePrompt }, ...history.filter(m => m.role !== "system")];
  }
  history.push({ role: "user", content: clean, imageBase64 });
  ```
- **현재 구조의 한계:**
  - 사용자 페르소나(이름, 호칭, 관계, 취향) 개념이 전무함.
  - 세계관/환경(시간대, 현재 장소, 날씨) 맥락이 없음.
  - 프롬프트가 단일 문자열로 결합되어 있어 부분 수정이나 동적 규칙 주입이 불가능함.

### 1.2 History 및 Context 관리 현황
- **저장 위치:** [`electron/main.ts`](file:///C:/TEST/MikuChat-v3/electron/main.ts#L24) 내 인메모리 배열 `let history: ChatMessage[] = [];`
- **컨텍스트 슬라이싱:**
  ```ts
  if (history.length > 16) {
    history = [history[0], ...history.slice(-14)];
  }
  ```
- **현재 구조의 한계:**
  - 단순 턴 수(16개 메시지) 기준 하드 컷 방식으로, 16턴을 초과하면 이전 대화가 영구 소실됨.
  - 토큰 예산(Token Budget) 계산이 없음 (Ollama는 `num_ctx: 4096` 하드코딩, Gemini는 `maxOutputTokens: 350` 지정).
  - 대화 요약(Rolling Summary)이나 장기 기억(Facts, Promises, Relationship)이 전혀 없음.

### 1.3 LLM 호출 및 스트리밍 처리
- **위치:** [`electron/llm.ts`](file:///C:/TEST/MikuChat-v3/electron/llm.ts)
  - `completeChat`: Ollama (`/api/chat` NDJSON 스트리밍), Gemini (`generateContent` REST), EasyProxy (OpenAI 호환 SSE 스트리밍) 지원.
  - 스트리밍 청크는 메인 프로세스의 `sentenceBuffer`에 누적된 후 문장 부호(`. ! ? \n`) 기준으로 분할(`extractConversationalChunks`)되어 즉시 TTS로 큐잉됨.

### 1.4 감정 태그 및 제스처 추론
- **위치:** [`src/shared/emotion.ts`](file:///C:/TEST/MikuChat-v3/src/shared/emotion.ts)
  - `parseReaction(raw: string)`: `[[emotion:...]]` 태그를 정규식으로 파싱하고, 태그가 없으면 텍스트 키워드 정규식(예: `고마워` → `bow`, `\?` → `curious`, `천재` → `proud`)으로 제스처 및 감정을 1회 추론.
  - **결함:** 첫 문장(`firstChunkHandled === true`)에서만 `broadcast(Ipc.GESTURE, reaction.gesture)`를 발송하므로, 복문/장문 응답에서 2번째 문장 이후의 동작은 전혀 트리거되지 않음.
  - **행동 서술 미분리:** `*고개를 끄덕인다*` 같은 마크다운 행동 묘사가 들어올 경우 이를 음성 텍스트에서 분리하지 못해 TTS가 그대로 읽어버리거나 음성이 왜곡됨.

### 1.5 3D 모션 및 VRM/VRMA 연동 파이프라인
- **모션 엔진:** [`src/character/MotionDirector.ts`](file:///C:/TEST/MikuChat-v3/src/character/MotionDirector.ts) (4-Layer 모션 컨트롤러: Base Idle VRMA + Gesture Layer + Gaze + Procedural V2 3축 진동 감쇠).
- **이벤트 버스:** [`src/character/motionEventBus.ts`](file:///C:/TEST/MikuChat-v3/src/character/motionEventBus.ts)
  - `MotionIntentData`: `{ emotion?: EmotionName; gesture?: "none"|"nod"|"wave"|"explain"|"laugh"|"think"; intensity?: number }`
  - 렌더러와 애니메이션 엔진이 이벤트 기반으로 완전히 분리되어 있어, 상위 계층에서 안전하게 모션을 호출할 수 있는 기반이 갖추어져 있음.

---

## 2. FocusAbove에서 실제 확인된 구조

`furabyss/FocusAbove`의 단일 HTML 소스(`index.html`, 약 5,300 LOC)를 직접 리버스 엔지니어링하여 검증한 실제 아키텍처는 다음과 같습니다.

### 2.1 대화 모드 (3 Interaction Modes)
1. **`chat` (기본 챗봇 모드):** 일반적인 어시스턴트 대화.
2. **`rp` (Roleplay 모드):**
   - 소설/상황극 형태의 서술문 지원.
   - 행동/심리 묘사는 `*이탤릭체*`, 대사는 `"큰따옴표"`로 작성하도록 시스템 지침 강제.
   - 3인칭/1인칭 시점 선택 및 서술 디테일 제어.
3. **`talk` (메신저/단문 모드):** 짧은 구어체 위주의 모바일 메신저 스타일.

### 2.2 프롬프트 구성 블록 (Hierarchical Prompt Composition)
FocusAbove는 단일 거대 프롬프트를 쓰지 않고 다음과 같은 우선순위 블록으로 동적 조립합니다:
1. **언어 및 기본 룰 (Language & Behavioral Constraints)**
2. **Character Card (캐릭터 프로필):** 이름, 성격, 배경, 시나리오, 첫 인사, 대화 예시(`<START>`).
3. **Persona Card (사용자 페르소나):** 유저 이름, 외모, 성향, 캐릭터와의 기본 관계.
4. **World Card (세계관 설정):** 시대적 배경, 물리/마법 법칙, 장소 설명 (단일 카드).
5. **Rolling Summary (`rpSummary`):** 이전 대화 요약문 (임계치 도달 시 압축 주입).
6. **Scene State (`rpSceneState`):** 현재 위치(Location), 시간(Time), 의상(Clothing), 자세/상태(Posture), 분위기/기분(Mood).
7. **대화 윈도우 (Recent Conversation Window):** 최근 대화 N턴.
8. **Author's Note (`[Author's Note - Highest Priority]`):** 컨텍스트 하단(최근 대화 2~4턴 전)에 주입하여 모델의 최신 응답 톤과 전개 방향을 강력하게 유도.

### 2.3 Rolling Summary 및 Scene State 갱신 로직
- **트리거 방식:** 토큰 사용량이 설정된 임계치(Context Threshold)를 초과할 경우 작동.
- **요약 생성:** 백그라운드에서 요약 프롬프트(`System: Summarize the key events, facts, and character relationship progression...`)로 LLM 호출.
- **컨텍스트 교체:** 오래된 턴들을 잘라내고(Trim) `rpSummary` 변수에 누적 갱신하여 최신 턴들만 보존.
- **Scene State:** 장소 이동이나 시간 경과 시 프롬프트 상단의 씬 상태 블록을 갱신.

### 2.4 FocusAbove의 TTS 처리
- TTS 텍스트 전송 시, 정규식을 통해 `*...*`로 감싸진 행동 서술을 제거하고 순수 대사(`"..."` 내부 또는 따옴표 없는 발화문)만 Web Speech API / TTS API로 전송.

---

## 3. 잘못 알려졌거나 확인되지 않은 기능 (False Assumptions)

외부 소문이나 추측과 달리, FocusAbove 소스코드에서 **존재하지 않음**이 명백히 확인된 항목들입니다:

| 항목 | 오해 / 루머 | 실제 소스코드 확인 결과 | MikuChat 설계 시 주의점 |
|---|---|---|---|
| **VRM / 3D 연동** | "FocusAbove에 3D 캐릭터나 VRM 연동 기능이 있다" | **완전 부재.** 순수 2D 웹 UI이며 3D 렌더러나 Three.js 코드가 일절 없음. | MikuChat의 독자적인 Three.js + VRM + MotionDirector 파이프라인 유지 필수. |
| **모션/제스처 엔진** | "FocusAbove의 행동 파서가 캐릭터 모션을 제어한다" | **완전 부재.** `*행동*` 문법은 단지 Markdown 렌더러(`marked.js`)를 거쳐 HTML `<em>` 태그로 표시되는 CSS 이탤릭일 뿐임. | MikuChat은 `ActionInterpreter`를 신설하여 3D `MotionDirector`로 연결해야 함. |
| **Lorebook / World Info** | "키워드 기반 정규식 트리거를 지원하는 Lorebook이 내장됨" | **확인 불가 (부재).** 단일 World Card 텍스트 필드만 존재하며, SillyTavern식 키워드 스캐닝 및 동적 인젝션 로직 없음. | 무리하게 복잡한 Lorebook을 모방하지 않고 `ContextProfile`로 단순화 설계. |
| **실시간 음성 상호작용** | "FocusAbove는 Realtime Full-Duplex 대화 시스템이다" | **부재.** 일반 텍스트 입력창 기반이며, Web Speech API를 이용한 단발성 STT/TTS만 존재함. | MikuChat의 기존 PTT 및 스트리밍 파이프라인 표준 준수. |

---

## 4. 프롬프트 조립 비교

| 항목 | FocusAbove 방식 | MikuChat-v3 현재 방식 | MikuChat 개선 권장 구조 (`PromptComposer`) |
|---|---|---|---|
| **조립 구조** | 모듈형 다단계 블록 빌더 (함수형 합성) | 단일 하드코딩 문자열 대입 (`MIKU_FREE_PROMPT`) | `PromptComposer` 파이프라인 (우선순위 블록 합성) |
| **캐릭터 분리** | Character Card (이름, 톤, 예시, 제약) 독립 | 프롬프트 내에 룰/성격/감정태그가 혼재 | `CharacterProfile` (성격, 말투, 금기어, 배경) 독립 |
| **사용자 페르소나** | Persona Card (유저 이름, 호칭, 관계) | 전혀 없음 (유저는 무명의 화자) | `PersonaProfile` (이름, 호칭, 관계, 관심사) 지원 |
| **세계관/배경** | World Card (고정 세계관 텍스트) | 튜터 모드 룰만 존재 | `ContextProfile` (공간, 시간대, 상황 모드) |
| **Scene State** | `rpSceneState` (위치, 시간, 의상, 무드) | 없음 | `SceneState` (VRM 모션 및 감정과 동기화) |
| **Author's Note** | 컨텍스트 하단 N번째 위치에 삽입 | 없음 | `AuthorNote` (대화 스타일 및 즉시 행동 지침 주입) |
| **대화 룰/서술 스타일** | Mode(chat/rp/talk)에 따라 지침 변경 | 자유/튜터 모드 2종만 존재 | Mode(Free / RP / Tutor)별 출력 형식 규정 |

---

## 5. History / Context 관리 비교

```text
[FocusAbove Context Pipeline]
Raw Messages → Token Count Check → [Threshold 초과?] 
       ├─ YES → Older Messages → LLM Summary → Update `rpSummary` → Trim Context
       └─ NO  → System Prompt + `rpSummary` + Recent Messages + Author's Note → LLM

[MikuChat-v3 현재 Pipeline]
Raw Messages → Length Check (> 16?) 
       ├─ YES → history = [system, ...history.slice(-14)] (과거 대화 영구 소각)
       └─ NO  → [system, ...messages] → LLM (Ollama/Gemini/EasyProxy)
```

### 문제점 진단:
1. **맥락 단절 (Amnesia):** 16턴이 지나면 사용자가 조금 전 말한 중요한 약속이나 이름, 이전 대화 내용이 즉시 사라집니다.
2. **토큰 비효율:** 메시지 길이(짧은 단답 vs 긴 문장)에 상관없이 무조건 16개로 자르므로, 짧은 대화에서는 컨텍스트 윈도우를 낭비하고 긴 대화에서는 토큰 오버플로우가 발생할 위험이 있습니다.
3. **지능적인 롤링 요약 부재:** 중요한 사실(Fact), 약속(Promise), 라포(Relationship)를 별도로 기억하지 못합니다.

---

## 6. 핵심 도입 후보 (Top 3 Subsystems)

과도한 복잡도를 피하고 MikuChat의 3D 아바타 강점을 극대화하기 위해 다음 3개 핵심 서브시스템을 설계 대상으로 선정합니다.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MikuChat Core Pipeline                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. CharacterCore & PromptComposer                                          │
│     (Character Card + Persona Card + Context Profile + Author's Note)       │
│                                  │                                          │
│                                  ▼                                          │
│  2. MemoryManager & SceneStateManager                                       │
│     (Token Budget + Rolling Summary + Relationship State + 3D Scene Mood)   │
│                                  │                                          │
│                                  ▼                                          │
│                         [ LLM Generation ]                                  │
│                                  │                                          │
│                                  ▼                                          │
│  3. ResponseParser & ActionInterpreter                                      │
│     ├─ Speech Text ────────────► TTS Sanitizer ──────► TTS & LipSync        │
│     └─ Narrative Action (*..*) ─► ActionInterpreter ──► GestureRequest ──┐ │
│                                                                          │  │
│                                  ┌───────────────────────────────────────┘  │
│                                  ▼                                          │
│                     MotionDirector (3D VRM Stage)                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. 후보 1: CharacterCore & PromptComposer 설계

### 7.1 역할 및 책임
- 정적 텍스트였던 미쿠 프롬프트를 **캐릭터 프로필**, **사용자 페르소나**, **세계관/맥락**, **행동/서술 룰**, **Author's Note**로 완전히 분리합니다.
- 모델 공급자(Ollama, Gemini, EasyProxy)의 사양에 맞게 단일 `system` 메시지로 안전하게 결합하거나 멀티 블록으로 직렬화합니다.

### 7.2 블록 다이어그램
```text
PromptComposer
│
├── [Priority 100] BaseConstraintBlock     (한국어 구어체, 문장부호, 금기사항)
├── [Priority 90]  CharacterProfileBlock   (하츠네 미쿠 정체성, 말투, 보컬로이드 설정)
├── [Priority 80]  PersonaProfileBlock     (사용자 이름, 호칭, 관계, 특징)
├── [Priority 70]  ContextProfileBlock     (현재 장소, 방 환경, 시간대, 날씨)
├── [Priority 60]  SceneStateBlock         (캐릭터 자세, 의상, 현재 분위기)
├── [Priority 50]  ConversationMemoryBlock (누적 롤링 요약, 중요 사실)
├── [Priority 40]  OutputFormatBlock       (RP 모드 서술 규칙: *행동*, "대사")
└── [Priority 10]  AuthorNoteBlock         (대화 직전 주입: 최신 행동 유도)
```

---

## 8. 후보 2: MemoryManager & SceneStateManager 설계

### 8.1 역할 및 책임
- 대화가 길어져도 캐릭터가 사용자와 나눈 과거 핵심 사건을 잊지 않도록 지원합니다.
- 단순 문자열 요약 외에 **관계 상태(Relationship State)**와 **현재 씬 상태(Scene State)**를 보존합니다.

### 8.2 토큰 예산 기반 Rolling Summary 트리거
- 하드코딩된 16턴 컷을 폐지하고 토큰 예산 방식으로 전환:
  ```text
  Context Window Budget = MaxCtxTokens (예: 4096)
  Trigger Threshold     = MaxCtxTokens * 0.60 (약 2450 토큰)
  Target Retention      = 최근 6~8 턴 (약 800 토큰)
  ```
- **요약 동작:**
  1. 전체 프롬프트 + 히스토리 추정 토큰이 임계치를 초과하면 트리거.
  2. 최근 6턴을 제외한 이전 대화 메시지들을 추출.
  3. 백그라운드 LLM 호출(Auxiliary request)을 통해 간결한 불릿 포인트 요약문 생성.
  4. 기존 `rollingSummary`에 누적 병합하고, 요약된 오래된 턴들은 히스토리에서 제거.

### 8.3 SceneStateManager와 VRM 연동
FocusAbove의 Scene State를 3D 공간에 맞게 확장합니다:
```ts
interface SceneState {
  location: string;        // 예: "미쿠의 작업실", "라이브 무대 대기실"
  time: string;            // 예: "방과 후 늦은 저녁"
  posture: string;         // 예: "의자에 앉아 편안히 기대어 있음"
  characterEmotion: EmotionName; // "happy" | "relaxed" | "neutral" ...
  energy: number;          // 0.0 ~ 1.0 (활력/텐션)
  clothing?: string;       // "기본 V2 의상"
}
```
- `SceneState.characterEmotion` 및 `energy`는 `MotionDirector`의 호흡 진폭(Respiration phase) 및 대기 모션 전환에 반영 가능.

---

## 9. 후보 3: ResponseParser & ActionInterpreter 설계

이 서브시스템은 **FocusAbove에는 없는 MikuChat 고유의 핵심 차별화 브릿지**입니다.

### 9.1 핵심 목표
LLM 응답에서 **음성으로 출력할 대사(Speech)**와 **3D 아바타가 취할 행동(Action)**을 완벽히 분리합니다.
1. **TTS 오염 방지:** `*고개를 끄덕이며 웃는다*`나 `(살며시 다가오며)` 같은 서술문이 TTS 음성으로 합성되는 참사를 100% 차단.
2. **자연스러운 3D 연기:** 추출된 서술문을 `ActionInterpreter`를 통해 MikuChat의 기존 `GestureName` 및 `EmotionName`으로 매핑하여 즉시 모션 재생.

### 9.2 분리 처리 파이프라인
```text
LLM 원문 스트림: "*손을 흔들며 밝게 웃는다.* 안녕! 오늘 하루는 어땠어?"
      │
      ▼
ResponseParser
      ├─ Speech Part:  "안녕! 오늘 하루는 어땠어?" ──► sanitizeSpeechForTts ──► TTS (음성 재생)
      └─ Action Part:  ["손을 흔들며 밝게 웃는다."] ──► ActionInterpreter ────► GestureRequest:
                                                                               - gesture: "wave"
                                                                               - emotion: "happy"
                                                                               - intensity: 0.8
                                                                               └─► MotionDirector
```

### 9.3 RP 출력 포맷 전략 비교

| 전략 | 예시 | 장점 | 단점 | MikuChat 적합도 및 추천 |
|---|---|---|---|---|
| **A. 자연어 마크다운 only** | `*고개를 끄덕인다.* 응, 좋아!` | 모델 호환성 최고, 가장 자연스러운 RP 생성 | 복잡한 서술 시 파싱 정규식 예외 발생 가능 | **추천 (1순위):** 소형 LLM(8B, 14B)에서도 지시 불이행이 거의 없고 자연스러움. |
| **B. Strict JSON only** | `{"speech":"응, 좋아!","gesture":"nod"}` | 완벽한 구조적 파싱, 데이터 모호성 제로 | 로컬 LLM의 스트리밍 JSON 깨짐 현상, 대화 몰입도 저하 | **비추천:** 8B급 양자화 모델에서 JSON 쉼표 누락 등으로 스트리밍 중단 위험 큼. |
| **C. Hybrid (Natural + Tag)** | `[[act:nod,happy]] *끄덕이며* 응, 좋아!` | 기존 emotion 태그 시스템과 호환 용이 | 텍스트 서술과 태그가 중복되어 토큰 낭비 | **대안 (2순위):** 파싱 안정성을 극대화해야 할 경우 채택 가능. |

> **설계 추천:** **전략 A (자연어 이탤릭 서술) 기반의 정교한 ResponseParser**를 기본으로 채택하고, 내부적으로 규칙 기반의 `ActionInterpreter`가 이를 제스처로 변환합니다.

---

## 10. ActionInterpreter / GestureRequest 연동 상세

### 10.1 현재 MikuChat 제스처 및 인텐트 타입 전수 검사
저장소 검사 결과 현재 사용 중인 타입은 다음과 같습니다:

1. **`GestureName` ([`src/shared/types.ts`](file:///C:/TEST/MikuChat-v3/src/shared/types.ts#L7)):**
   `"idle" | "wave" | "nod" | "talk" | "cheer" | "sing" | "thinking" | "peace" | "shy" | "bow" | "curious" | "giggle" | "proud" | "explain" | "laugh" | "think" | "shoot" | "spin"` (총 18종)
2. **`MotionIntentData` ([`src/character/motionEventBus.ts`](file:///C:/TEST/MikuChat-v3/src/character/motionEventBus.ts#L17-L21)):**
   ```ts
   export interface MotionIntentData {
     emotion?: "neutral" | "happy" | "relaxed" | "sad" | "angry" | "surprised";
     gesture?: "none" | "nod" | "wave" | "explain" | "laugh" | "think";
     intensity?: number;
   }
   ```

### 10.2 GestureRequest 비교표 (지침 제16조 요구사항)

| 필요 정보 | 현재 타입에 있음 | 확장 필요 사항 및 분석 |
|---|:---:|---|
| **gesture** | **있음** | `GestureName`에는 18종이 정의되어 있으나, `MotionIntentData.gesture` 유니온에는 6종(`nod`, `wave`, `explain`, `laugh`, `think`, `none`)만 축소 정의되어 있어 불일치함. `GestureName` 전체를 허용하도록 동기화 확장 필요. |
| **intensity** | **있음 (미사용)** | `MotionIntentData`에 선언되어 있으나 `MotionDirector.play()`에서 실제 블렌딩 가중치나 속도에 반영하지 않고 있음. 향후 파라미터 연동 필요. |
| **expression / emotion** | **있음** | `EmotionName` 6종(`neutral`, `happy`, `angry`, `sad`, `surprised`, `relaxed`) 완비 및 `VrmStage.setEmotion()`과 직결됨. |
| **gaze** | **없음** | 현재 LookAt은 마우스 커서 또는 절차적 드리프트에 의존함. 시선 회피(`gazeAway`), 사용자 응시(`gazeUser`), 아래 보기(`gazeDown`) 등의 타겟 지정 필드 확장 필요. |
| **duration** | **없음** | 현재 모션 길이는 VRMA 클립 길이 또는 하드코딩 상수(`GESTURE_MAX_DURATION = 5.0`)로 고정됨. 발화 길이에 맞춘 제어 필드 확장 권장. |
| **priority** | **없음** | 쿨다운(`globalCooldown = 2.5s`, `sameGesture = 8.0s`)만 존재하고 이벤트 우선순위 큐가 없음. 긴급 제스처(놀람, 빵야 등) 선점을 위해 필요. |

### 10.3 행동 서술 매핑 테이블 (Action Mapping Rules)

`ActionInterpreter`가 자연어 서술문에서 키워드를 파싱하여 매핑할 정규식 규칙:

| 행동 서술 키워드 패턴 | 매핑 GestureName | EmotionName | 비고 |
|---|---|---|---|
| `고개를 끄덕`, `고개를 숙여`, `수긍하듯` | `nod` | `happy` 또는 `relaxed` | 부드러운 동의 제스처 |
| `손을 흔들`, `손을 번쩍`, `반갑게 인사` | `wave` | `happy` | 0.45s 숄더 엘리베이션 적용 |
| `고개를 갸웃`, `물끄러미 바라보`, `궁금한 듯` | `curious` (or `think`) | `relaxed` | 호기심 어린 시선 및 고개 틸트 |
| `입을 가리고 웃`, `풋 하고 웃`, `작게 미소` | `giggle` (or `laugh`) | `happy` | 손으로 입 가리는 귀여운 모션 |
| `생각에 잠기`, `턱을 괴고`, `고민하듯` | `think` | `relaxed` | 턱에 손 올리기 |
| `자랑스럽게`, `허리에 손을 올리`, `당당하게` | `proud` | `happy` | 양손 허리(Akimbo) 포즈 |
| `손가락으로 브이`, `장난스레 브이` | `peace` | `happy` | V사인 및 윙크 |
| `환호하듯`, `두 손을 들고`, `신나서` | `cheer` | `happy` | 전신 점프/환호 모션 |
| `공손히 인사`, `허리를 숙여 절` | `bow` | `happy` | 16도 정중한 일본식 목례 |
| `손총을 쏘듯`, `빵야`, `윙크하며 겨누` | `shoot` | `happy` | VRMA_04 손총 모션 |
| `빙글 돌며`, `한 바퀴 회전` | `spin` | `happy` | VRMA_05 360도 턴 모션 |

---

## 11. TTS / LipSync / Animation 영향 분석

스트리밍 환경에서 행동 파싱과 음성 재생이 결합될 때 발생할 수 있는 레이턴시 및 동기화 이슈 분석:

### 11.1 스트리밍 중 실시간 파싱 가능성
- **분석:** 현재 MikuChat은 토큰 스트림을 `sentenceBuffer`에 모은 뒤 완전한 문장 부호(`. ! ? \n`)가 나오면 쪼개어 TTS로 보냅니다.
- **파싱 전략:** 각 문장 청크마다 `ResponseParser.parseChunk(chunk)`를 실행하여 앞머리의 `*...*` 서술을 즉시 발라내고, 순수 대사만 TTS 큐로 보냅니다.
- **결론:** 스트리밍 중에도 지연 없이 완벽하게 실시간 분리가 가능합니다.

### 11.2 문장 완성 전 제스처 트리거 및 레이턴시
- **상황:** LLM이 `*활짝 웃으며 손을 흔든다.* 안녕하세요!`라고 생성할 때.
- **동작 흐름:**
  1. 첫 토큰들에서 `*활짝 웃으며 손을 흔든다.*`가 먼저 완성됨.
  2. TTS가 문장을 합성하기 위해 대기하는 수백 ms(First Audio Latency) 동안, `ActionInterpreter`는 **선제적으로 제스처(`wave`)와 표정(`happy`)을 캐릭터 창으로 즉시 발송**.
  3. 캐릭터가 손을 들며 웃기 시작할 때 첫 음성(TTS)과 립싱크가 재생됨!
- **장점:** 음성 합성 딜레이(약 0.8~1.5초) 동안 아바타가 멍하니 멈춰있는 "T-pose/침묵 현상"을 없애고, **극도로 빠른 시각적 반응성(First-Motion Latency < 200ms)**을 달성할 수 있습니다.

### 11.3 TTS Chunking과의 충돌 방지
- 문장 중간에 `*...*`가 걸치거나 줄바꿈이 일어나는 경우를 대비하여 `ResponseParser` 내부에 미완성 마크다운 토큰 버퍼를 두어 대사가 쪼개져 나가는 것을 방지합니다.

---

## 12. Realtime Voice 및 ToolRouter와의 호환성

### 12.1 Realtime Voice (VAD/STT/Streaming TTS) 호환성
- 향후 전이중(Full-Duplex) 음성 대화가 도입되더라도 `ResponseParser`는 텍스트 스트림 계층에 위치하므로, LLM의 텍스트 토큰 출력단에서 대사와 행동을 분리하는 구조는 100% 동일하게 유지됩니다.

### 12.2 ToolRouter(도구 호출)와 Memory의 명확한 분리
- 향후 웹 검색(`web_search`), 날씨(`weather`), 주식(`stock_quote`) 등의 외부 도구가 추가될 경우:
  - **CharacterCore / MemoryManager:** 캐릭터의 정체성, 사용자와의 친밀도, 과거 기억만을 전담.
  - **ToolRouter:** 외부 최신 사실 정보를 조회하여 `ToolContextBlock`으로 프롬프트에 주입.
  - 두 시스템의 상태를 섞지 않고 완전한 단방향 의존성으로 격리합니다.

---

## 13. 상세 데이터 타입 설계 (Proposed TypeScript Types)

실제 구현 시 사용될 핵심 인터페이스 설계입니다 (현재 소스 미생성, 설계용):

```ts
// src/core/character/types.ts

export type CharacterMode = "free" | "rp" | "tutor";

/** 1. 캐릭터 프로필 카드 */
export interface CharacterProfile {
  id: string;
  name: string;
  avatarUrl?: string;
  title: string;
  description: string;
  personality: string[];
  speakingStyle: {
    tone: string;
    endings: string[];
    forbiddenWords: string[];
  };
  scenario: string;
  exampleDialogues?: Array<{ user: string; assistant: string }>;
}

/** 2. 사용자 페르소나 카드 */
export interface PersonaProfile {
  userName: string;
  callName: string; // 캐릭터가 사용자를 부르는 호칭 (예: "마스터", "선배")
  traits: string[];
  relationship: string; // "다정하고 편안한 친구 사이"
  languagePreference: "ko" | "ja" | "en";
}

/** 3. 세계관 및 컨텍스트 프로필 */
export interface ContextProfile {
  worldName: string;
  location: string;
  environmentLore: string;
  timeContext: string;
}

/** 4. 대화 메모리 (장기 기억 및 롤링 요약) */
export interface ConversationMemory {
  rollingSummary: string;
  facts: string[];
  relationshipState: string;
  promises: string[];
  openThreads: string[];
  summarizedTurnCount: number;
}

/** 5. 3D 씬 상태 (VRM 및 모션 연동) */
export interface SceneState {
  location: string;
  timePeriod: string;
  characterEmotion: EmotionName;
  energyLevel: number; // 0.0 ~ 1.0
  posture: string;
  gazeTarget: "user" | "away" | "down" | "object";
  clothing?: string;
}

/** 6. 프롬프트 구성 블록 */
export interface PromptBlock {
  id: string;
  priority: number;
  content: string;
  estimatedTokens?: number;
}

/** 7. 응답 파서 출력 구조 */
export interface ParsedAssistantResponse {
  raw: string;
  speechText: string;     // TTS로 보낼 순수 대사 (행동 서술 완전 제거)
  displayProse: string;   // 채팅창에 렌더링할 서술문 (마크다운 이탤릭 유지)
  actionCues: string[];   // 파싱된 행동 서술 배열
  inferredGesture?: GestureName;
  inferredEmotion?: EmotionName;
}

/** 8. 확장된 제스처 요청 */
export interface ExtendedGestureRequest {
  gesture: GestureName;
  emotion?: EmotionName;
  intensity?: number;      // 0.0 ~ 1.0
  durationSec?: number;
  priority?: "low" | "normal" | "high";
  gaze?: "user" | "away" | "down";
}
```

---

## 14. 변경 대상 파일 및 영향도 분석

현재 소스코드 기준으로 향후 실제 구현 시 변경될 대상 파일 목록입니다:

| 파일 경로 | 현재 역할 | 계획된 변경 내용 | 규모 (추정) | 위험도 |
|---|---|---|:---:|:---:|
| [`src/shared/types.ts`](file:///C:/TEST/MikuChat-v3/src/shared/types.ts) | 전역 공유 타입 정의 | `CharacterMode`("rp" 추가), `SceneState`, `ExtendedGestureRequest` 타입 추가 | 약 30~50 LOC | 낮음 |
| [`src/shared/persona.ts`](file:///C:/TEST/MikuChat-v3/src/shared/persona.ts) | 하드코딩된 프롬프트 문자열 | 기본 `CharacterProfile` 상수 및 블록 템플릿으로 리팩토링 | 약 50~80 LOC | 낮음 |
| [`src/shared/emotion.ts`](file:///C:/TEST/MikuChat-v3/src/shared/emotion.ts) | `parseReaction` 감정 태그 파싱 | `ResponseParser` 및 `ActionInterpreter` 호출 위임 래퍼로 개편 | 약 40~60 LOC | 중간 |
| [`electron/main.ts`](file:///C:/TEST/MikuChat-v3/electron/main.ts) | IPC 브로드캐스트, LLM 호출, TTS 큐잉 | `PromptComposer`, `MemoryManager`, `ResponseParser` 연동, 16턴 하드컷 제거 | 약 80~120 LOC | 중간 |
| [`electron/llm.ts`](file:///C:/TEST/MikuChat-v3/electron/llm.ts) | LLM 스트리밍 완료 처리 | 시스템 프롬프트 멀티 블록 주입 및 토큰 파라미터 유연화 | 약 20~40 LOC | 낮음 |
| [`src/overlay/main.ts`](file:///C:/TEST/MikuChat-v3/src/overlay/main.ts) | 채팅창 UI, 스트리밍 렌더링 | RP 모드 탭 추가, 서술문 이탤릭 스타일링, 페르소나 표시 | 약 40~70 LOC | 낮음 |
| [`src/character/motionEventBus.ts`](file:///C:/TEST/MikuChat-v3/src/character/motionEventBus.ts) | 모션 이벤트 버스 | `MotionIntentData`에 전체 18종 `GestureName` 및 gaze/intensity 매핑 확장 | 약 15~25 LOC | 낮음 |
| [`src/character/MotionDirector.ts`](file:///C:/TEST/MikuChat-v3/src/character/MotionDirector.ts) | 3D 모션 컨트롤러 | `ExtendedGestureRequest`의 emotion/intensity 연동 처리 | 약 30~50 LOC | 중간 |

---

## 15. 신규 파일 후보

향후 실제 기능 구현 시 신설될 파일 구조입니다 (현재 작업에서는 파일 생성 안 함):

```text
src/
├── core/
│   ├── character/
│   │   ├── CharacterCore.ts       (캐릭터 프로필, 페르소나, 세계관 상태 저장소)
│   │   └── types.ts               (캐릭터, 페르소나, 씬 상태 인터페이스)
│   ├── prompt/
│   │   ├── PromptComposer.ts      (우선순위 기반 프롬프트 블록 조립기)
│   │   └── blocks.ts              (BaseRules, Character, Persona, Memory 등 개별 블록)
│   ├── memory/
│   │   ├── MemoryManager.ts       (토큰 계산, 롤링 요약, 장기 기억 관리)
│   │   └── SceneStateManager.ts   (위치, 시간, 자세, 분위기 상태 관리)
│   └── response/
│       ├── ResponseParser.ts      (대사 vs 행동 서술 스트리밍 분리기)
│       └── ActionInterpreter.ts   (자연어 행동 서술 -> GestureRequest 매핑기)
```

---

## 16. 예상 변경 규모 (LOC Estimation)

1. **`CharacterCore` & `PromptComposer` Subsystem**
   - 신규 파일: 약 180 ~ 260 LOC
   - 기존 파일 수정: 약 40 ~ 70 LOC
2. **`MemoryManager` & `SceneStateManager` Subsystem**
   - 신규 파일: 약 220 ~ 320 LOC
   - 기존 파일 수정: 약 50 ~ 90 LOC
3. **`ResponseParser` & `ActionInterpreter` Subsystem**
   - 신규 파일: 약 160 ~ 240 LOC
   - 기존 파일 수정: 약 40 ~ 80 LOC

---

## 17. 단계별 구현 계획 (Implementation Roadmap)

> **주의:** 본 문서는 조사 및 설계 문서이며, 아래 10단계 구현 계획은 향후 사용자의 명시적 승인 후 순차적으로 진행됩니다. 현재 단계에서는 어떤 파일도 작성하거나 수정하지 않습니다.

1. **Step 1: 타입 및 인터페이스 선언 (`src/core/character/types.ts`)**
   - `CharacterProfile`, `PersonaProfile`, `SceneState`, `ConversationMemory` 정의.
2. **Step 2: `PromptComposer` 구현 (`src/core/prompt/`)**
   - 우선순위 기반 모듈형 블록 빌더 작성 및 기존 `MIKU_FREE_PROMPT` 대체 단위 테스트.
3. **Step 3: 토큰 예산 산출기 및 History 추적기 구현**
   - 단어/글자 수 기반 토큰 추정치 산출 함수 및 슬라이딩 윈도우 버퍼 구축.
4. **Step 4: `MemoryManager` 롤링 요약 엔진 구현**
   - 임계치 초과 시 백그라운드 LLM 요약 호출 및 `rollingSummary` 갱신 로직 연동.
5. **Step 5: 관계 및 주요 사실 기억 저장소 연동**
   - `relationshipState`와 `facts` 추출 및 컨텍스트 주입.
6. **Step 6: `SceneStateManager` 구현**
   - 장소/시간/분위기 상태 관리 및 `MotionDirector` 초기 감정 상태 연동.
7. **Step 7: `ResponseParser` 구현 (`src/core/response/ResponseParser.ts`)**
   - `*행동 서술*`과 `"발화 대사"` 정규식 스트리밍 파서 구현 및 TTS 정제 필터 연결.
8. **Step 8: `ActionInterpreter` 구현 (`src/core/response/ActionInterpreter.ts`)**
   - 행동 서술문을 `GestureName` 18종 및 감정 태그로 변환하는 룰베이스 매퍼 구축.
9. **Step 9: `main.ts` 파이프라인 통합 및 TTS 음성 정제 연결**
   - TTS로 순수 대사만 전달하고 `*행동*` 낭독 100% 제거 확인.
10. **Step 10: `MotionDirector` 및 3D 렌더러 최종 결합**
    - 파싱된 제스처가 First-Motion으로 선제 재생되고 립싱크와 일치하는지 종합 검증.

---

## 18. 테스트 계획 (Verification & QA Matrix)

| 테스트 카테고리 | 테스트 시나리오 | 기대 결과 (Pass Criteria) |
|---|---|---|
| **캐릭터 일관성** | 100턴 이상의 장기 대화 진행 | 미쿠 특유의 구어체 및 상냥한 톤 유지, 사용자 호칭 및 설정 유지 |
| **장기 기억 유지** | 초반에 약속한 내용("내일 7시에 노래방 가자")을 30턴 후 질문 | 롤링 요약에 의해 약속 내용이 기억되어 정확하게 대답함 |
| **Scene State** | 대화 중 장소가 방에서 공원으로 변경됨 | `SceneState.location`이 갱신되고 배경에 맞는 대사 생성 |
| **TTS 입력 정제** | `*미쿠가 쑥스러운 듯 손을 모으며 작게 웃는다.* 에헤, 고마워!` | **TTS 음성:** 오직 "고마워!"(또는 "헤헤, 고마워!")만 발음되어야 함. `*쑥스러운 듯...*`은 음성에 전혀 포함되지 않음. |
| **제스처 매핑** | `*손을 힘차게 흔든다.* 안녕!` 출력 시 | `MotionDirector`에 `wave` 제스처가 즉시 트리거되어 3D 아바타가 손을 흔듬 |
| **기존 기능 회귀 검증** | 튜터 모드(SRS 단어 수집, 4지선다 퀴즈), 화면/마우스 캡처, 보이스 프리셋 변경 | 기존 기능 100% 정상 작동 및 에러 로그 0건 유지 |

---

## 19. 위험 요소 및 롤백 전략

### 19.1 위험 요소 (Risks)
1. **로컬 LLM 지시 불이행 (Instruction Drift):**
   - 소형 모델(8B급)이 RP 모드에서 따옴표나 별표 서술 규칙을 어기고 일반 텍스트로 답할 수 있음.
   - **대책:** `ResponseParser`에 Fallback 로직을 두어, 별표가 없으면 기존 문장 기반의 `parseReaction` 키워드 매핑으로 안전하게 대체.
2. **요약 생성 시 지연 및 부하:**
   - 대화 중간에 롤링 요약을 생성하느라 메인 대화 응답이 밀릴 수 있음.
   - **대책:** 롤링 요약은 비동기 백그라운드 태스크로 분리하여 메인 턴의 대화 흐름을 절대 블로킹하지 않음.
3. **제스처 쿨다운 충돌:**
   - LLM이 한 문장에서 여러 행동을 서술할 때 제스처가 겹쳐 어색해질 수 있음.
   - **대책:** `MotionDirector`의 기존 2.5초 글로벌 쿨다운 및 8초 동일 모션 쿨다운 규칙을 엄격히 유지.

### 19.2 롤백 전략 (Rollback Plan)
- 모든 신규 컴포넌트는 `src/core/` 디렉토리에 독립 모듈로 생성되므로, 비정상 동작 발생 시 `electron/main.ts`의 프롬프트 호출부 2개 지점만 기존 `MIKU_FREE_PROMPT`로 복구하면 30초 내에 완벽한 롤백이 가능합니다.

---

## 20. FocusAbove MIT 라이선스 주의사항

`furabyss/FocusAbove`는 **MIT License** 하에 공개된 오픈소스 프로젝트입니다.
- **라이선스 조항 준수:** 향후 구현 단계에서 FocusAbove의 프롬프트 엔지니어링 패턴, 서술 지침 템플릿, 데이터 구조 아이디어를 채택하거나 코드를 참조하는 경우, MikuChat-v3의 제3자 라이선스 고지 문서(`docs/THIRD_PARTY_LICENSES.md`) 또는 소스 파일 헤더에 아래 저작권 고지를 명시해야 합니다:
  ```text
  Portions of the character prompt structure and scene state concepts are inspired by:
  FocusAbove (https://github.com/furabyss/FocusAbove)
  Copyright (c) 2024 furabyss
  Licensed under the MIT License.
  ```
- **현재 상태:** 본 작업은 순수 설계 및 비교 연구만 진행하였으며, FocusAbove의 실제 코드를 복사하거나 이식하지 않았습니다.

---
*(문서 작성 완료 - 구현 착수 없이 사용자 승인 대기)*
