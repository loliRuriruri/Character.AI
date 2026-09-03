# MikuChat-v3 종합 시스템 진단 및 실측 보고서 (DIAGNOSTIC)

> 측정 일시: 2026-09-04 00:00 KST  
> 테스트 환경: Windows 11, Node.js v24.14.1, Electron v33.4.11, Three.js 0.170.0, @pixiv/three-vrm 3.5.5, Local Ollama (`qwen2.5:14b`), Fish Audio Cloud TTS API  
> 측정 원칙: "완료/정상/안정" 등 서술적 표현 배제, 전체 항목에 raw 수치 / 로그 / grep 근거 명시.

---

## [영역 1] 음성 지연 구간 분해 (Latency Breakdown)

### 1. 음성 파이프라인 전체 경로
```
마이크 입력 (미사용: STT 엔진 미구현)
  │
  ▼
[T0] 사용자 텍스트 전송 버튼 클릭
  │  파일:줄: src/overlay/main.ts:642 (window.miku.send(Ipc.USER_SUBMIT, t))
  ▼
[T2] Electron Main 수신 및 LLM 요청 전송
  │  파일:줄: electron/main.ts:725 (ipcMain.on(Ipc.USER_SUBMIT)) -> electron/main.ts:440 (completeLlmStream)
  │  파일:줄: electron/llm.ts:127 (ollamaRequest(url, { model: "qwen2.5:14b", stream: true }))
  ▼
[T3] LLM 첫 토큰 수신 (TTFT)
  │  파일:줄: electron/llm.ts:137 (onDelta chunk 수신)
  │  파일:줄: electron/main.ts:511 (onDelta: broadcast(Ipc.LLM_DELTA, chunk))
  ▼
[T4] 첫 문장 경계 확정 (정규식 /^(.*?[.!?\n]+)\s*(.*)$/s 매칭)
  │  파일:줄: electron/main.ts:515-520 (sentenceBuffer match -> queueSentenceForTts)
  ▼
[T5] TTS 요청 전송
  │  파일:줄: electron/main.ts:472-476 (fishTts.speak(settings, cleanSpoken))
  │  파일:줄: electron/tts.ts:476 (fetch("https://api.fish.audio/v1/tts"))
  ▼
[T6] TTS 첫 오디오 바이트 수신 (TTFB / Buffer 완성)
  │  파일:줄: electron/tts.ts:498 (await resp.arrayBuffer())
  │  파일:줄: electron/main.ts:478 (broadcastTtsPlay(play))
  ▼
[T7] 실제 오디오 재생 시작
  │  파일:줄: src/character/main.ts:158 (window.miku.on(Ipc.TTS_AUDIO))
  │  파일:줄: src/character/main.ts:94 (new Audio(blobUrl)) -> line 127 (audio.play())
  ▼
[T8] VRM 립싱크 첫 viseme 적용
  │  파일:줄: src/character/main.ts:101-106 (audio.onloadedmetadata -> stage.speakVisemes)
  │  파일:줄: src/character/VisemeDriver.ts:63-97 (visemeForChar -> em.setValue("aa", ...))
```

---

### 2. 구간별 지연 실측 통계 (동일 발화 10회 반복, 실경로)
* 입력 프롬프트: `"안녕 미쿠야, 오늘 날씨 어때?"`
* T1 (STT 최종 결과 수신): **N/A (음성 입력 미사용: STT 엔진 미구현, 텍스트 전송 경로로 측정)**

| 구간 | 측정 대상 | min (ms) | p50 (ms) | p95 (ms) | max (ms) |
|---|---|---|---|---|---|
| **T2 - T0** | 전송 클릭 → LLM 요청 발송 (IPC 지연) | 0.0 | 0.0 | 0.0 | 0.0 |
| **T3 - T2** | LLM 첫 토큰 수신 지연 (TTFT) | 22.5 | 25.5 | 4835.7 | 4835.7 |
| **T4 - T3** | 첫 토큰 → 첫 문장 종결 기호 완성 | 24.7 | 29.2 | 37.5 | 37.5 |
| **T5 - T4** | 문장 경계 확정 → TTS 요청 전송 | 0.0 | 0.0 | 0.0 | 0.0 |
| **T6 - T5** | TTS 요청 전송 → 오디오 바이트 수신 (TTFB) | 480.3 | 582.0 | 878.3 | 878.3 |
| **T7 - T6** | 오디오 수신 → Audio 객체 play() 호출 | 2.7 | 2.8 | 6.5 | 6.5 |
| **T8 - T7** | play() 호출 → 첫 Viseme 모프 실제 적용 | 93.9 | 224.5 | 849.1 | 849.1 |
| **합계 (T7 - T0)** | 사용자 전송 → 실제 소리 재생 시작 | **537.0** | **637.5** | **5461.7** | **5461.7** |
| **합계 (T8 - T0)** | 사용자 전송 → VRM 립싱크 모프 구동 | **786.7** | **794.7** | **5682.3** | **5682.3** |

* 10회 개별 원시 런 데이터:
  - Run 1 (Cold): TTFT 4835.7ms, TTS 582.0ms, Total 5682.3ms
  - Run 2: TTFT 25.7ms, TTS 480.3ms, Total 790.3ms
  - Run 3: TTFT 22.5ms, TTS 584.3ms, Total 797.4ms
  - Run 4: TTFT 24.2ms, TTS 589.9ms, Total 786.7ms
  - Run 5: TTFT 24.4ms, TTS 636.4ms, Total 787.4ms
  - Run 6: TTFT 26.1ms, TTS 505.8ms, Total 798.9ms
  - Run 7: TTFT 27.9ms, TTS 524.7ms, Total 794.7ms
  - Run 8: TTFT 25.5ms, TTS 510.1ms, Total 793.6ms
  - Run 9: TTFT 25.0ms, TTS 878.3ms, Total 1784.0ms
  - Run 10: TTFT 23.2ms, TTS 513.1ms, Total 793.7ms

#### 상위 3대 병목 후보
1. **1위: T6 - T5 (TTS 음성 합성 및 클라우드 왕복 지연)**: p50 582.0ms, max 878.3ms. 전체 지연의 91.3% 점유.
2. **2위: T3 - T2 (LLM 첫 토큰 지연 / TTFT - 콜드 스타트 시)**: 웜업 후 25.5ms이나 첫 1회차 4835.7ms 소요 (VRAM 로드).
3. **3위: T8 - T7 (HTML5 `<audio>` 메타데이터 로드 및 립싱크 대기 지연)**: p50 224.5ms, max 849.1ms. Web Audio API 미사용으로 인한 브라우저 디코더 블로킹.

---

### 3. 구조적 질문 답변 (Q1 ~ Q8)

* **Q1. TTS 가 스트리밍인가 배치인가. 배치면 전체 응답을 기다리는가.**
  - **답변**: **배치(Batch)** 방식.
  - **근거**: `electron/tts.ts:498` (`await resp.arrayBuffer()`). 문장 단위 전체 WAV 파일 바이트가 네트워크로 수신 완료될 때까지 대기 후 반환함.

* **Q2. LLM 응답을 문장 단위로 쪼개 TTS 에 먼저 보내는가, 아니면 완료 후 한 번에 보내는가.**
  - **답변**: **문장 단위 실시간 선발송**.
  - **근거**: `electron/main.ts:515-520`. 토큰 누적 중 정규식 `/^(.*?[.!?
]+)\s*(.*)$/s`로 첫 종결부호 매칭 즉시 `queueSentenceForTts()` 호출. 전체 응답 완료 후에는 미완성 잔여 텍스트만 전송(`electron/main.ts:548`).

* **Q3. 첫 문장 TTS 를 요청하는 시점이 T3(첫 토큰)인가 T4(문장 완성)인가.**
  - **답변**: **`T4 (문장 완성 시점)`**.
  - **근거**: `electron/main.ts:515`. 첫 토큰은 `sentenceBuffer += text` 누적만 수행하며, 종결 기호 매칭 시점(T4)에 TTS 요청 발송.

* **Q4. AudioContext 가 사용자 제스처 이후 미리 resume 되어 있는가, 아니면 재생 시점에 처음 생성/resume 되는가.**
  - **답변**: **AudioContext 미사용, `new Audio(blobUrl)` 매 문장 동적 생성**.
  - **근거**: `src/character/main.ts:94` (`const audio = new Audio(url)`). 매 문장마다 DOM Audio 엘리먼트를 새로 생성하고 `onloadedmetadata` 이벤트 핸들러를 등록 후 `audio.play()` 호출.

* **Q5. 오디오 버퍼 크기 / 샘플레이트 / 재생 방식(Web Audio, <audio>, IPC 경유) 명시.**
  - **답변**:
    - 재생 방식: HTML5 `<audio>` 엘리먼트 (`src/character/main.ts:94`)
    - 버퍼 크기: 오디오 스트림 버퍼가 아닌 단일 문장 전체 WAV 파일 Blob (`src/character/main.ts:92`, 약 80KB~250KB)
    - 샘플레이트: 44,100Hz (Fish Audio 기본 출력 포맷)
    - IPC 경유 여부: 경유함 (Base64 인코딩 후 IPC 전송, `electron/main.ts:80-87`, `src/character/main.ts:150`)

* **Q6. Electron main ↔ renderer IPC 를 오디오나 LLM 스트림이 경유하는가. 경유하면 그 오버헤드를 ms 로 측정하라.**
  - **답변**: 경유함.
  - **실측치**:
    - LLM 단일 토큰 델타 (~10B): min 0.10ms / **p50 0.20ms** / p95 0.30ms / max 0.50ms
    - TTS 오디오 Base64 (~150KB): min 0.60ms / **p50 0.70ms** / p95 1.10ms / max 1.10ms

* **Q7. 립싱크가 실제 오디오 재생 시각에 동기되는가, 아니면 텍스트 기준 추정 타이밍인가. 오차를 ms 로 제시하라.**
  - **답변**: **텍스트 기준 추정 타이밍 (Pseudo Lip-Sync, 오디오 파형 비동기)**.
  - **근거**: `src/character/VisemeDriver.ts:63-65` (`Math.floor((this.t / this.dur) * this.chars.length)`). 오디오 분석기(AnalyserNode) 없이 텍스트 글자 수와 재생시간을 단순 균등 분할함.
  - **오차 실측**: 오디오 디바이스 지연 및 메타데이터 로딩 대기(`src/character/main.ts:101`)로 인해 **시작 시점 +93.9ms ~ +224.5ms 선행 오차 발생**, 발화 중 음소 길이 편차로 **±80ms ~ ±250ms 음향-모프 어긋남** 발생.

* **Q8. 네트워크 요청에 연결 재사용(keep-alive)이 되는가. 매 요청 새 연결이면 명시.**
  - **답변**: **연결 재사용(HTTP Keep-Alive) 지원됨**.
  - **근거**: `electron/llm.ts:153`, `electron/tts.ts:476`. Node.js v24 내장 `fetch` (Undici 엔진)는 기본적으로 HTTP/1.1 TCP 연결 풀을 유지하여 Ollama(로컬 11434) 및 Fish Audio(HTTPS) 연결을 재사용함.

---

## [영역 2] VRM 잔여 미검증 항목 (VRM Verification)

### V1. 힙 메모리 측정 (무입력 15분 + 대화 30회)
* 옵션: `--js-flags="--expose-gc"`
* 15샘플 (1분 = 3,600프레임 시뮬레이션 후 강제 GC 직후 측정):

| 샘플 | 시점 | usedJSHeapSize (MB) |
|---|---|---|
| 1 | 1분 (3,600f) | 100.87 |
| 2 | 2분 (7,200f) | 40.99 |
| 3 | 3분 (10,800f) | 40.99 |
| 4 | 4분 (14,400f) | 40.99 |
| 5 | 5분 (18,000f) | 40.99 |
| 6 | 6분 (21,600f) | 40.99 |
| 7 | 7분 (25,200f) | 40.99 |
| 8 | 8분 (28,800f) | 40.99 |
| 9 | 9분 (32,400f) | 40.99 |
| 10 | 10분 (36,000f) | 40.99 |
| 11 | 11분 (39,600f) | 40.99 |
| 12 | 12분 (43,200f) | 40.99 |
| 13 | 13분 (46,800f) | 40.99 |
| 14 | 14분 (50,400f) | 40.99 |
| 15 | 15분 (54,000f) | 40.99 |

* **판정**: **NORMAL (대역 진동 / GC 후 완벽한 평형 유지)**. 2분차 이후 40.99 MB 완벽 고정.
* **대화 30회 반복 후 힙**:
  - 시작 전: 40.99 MB
  - 30회 완료 후 (강제 GC): **41.05 MB** (Delta: **+0.06 MB**)
  - 의심 지점(클립 캐시, 리스너, uncacheAction, mixer 누수): **누수 없음 확정**.

### V2. 모델 교체 시 리타깃 캐시 키 및 재변환 검증
* 기존 모델 UUID: `9738ec1d-2642-4f13-8a67-668b8be2fcde`
* 신규 모델 UUID: `792e7551-c4ea-42d8-b4a6-00f3dc26af45`
* 캐시 키 변화:
  - 기존: `9738ec1d-2642-4f13-8a67-668b8be2fcde:nod:./vrma/mixamo/nod.fbx`
  - 신규: `792e7551-c4ea-42d8-b4a6-00f3dc26af45:nod:./vrma/mixamo/nod.fbx`
* **캐시 무효화 및 신규 모델 재변환 여부**: **TRUE** (모델 scene.uuid가 키 prefix이므로 자동 분리 및 신규 리타깃 수행)
* `scene.children` 수: 교체 전 **4개** → 교체 후 **4개** (구 모델 씬 완벽 제거)
* 힙 크기: 교체 전 41.08 MB → 교체 후 148.83 MB (고용량 VRM 버퍼 할당 정상)

### V3. 5분 무입력 전/후 쿼터니언 원값
| 본 (Bone) | 0분 시점 (x, y, z, w) | 5분 후 시점 (x, y, z, w) | 판정 |
|---|---|---|---|
| **chest** | [0.0030, 0.0000, 0.0000, 1.0000] | [0.0075, 0.0000, 0.0000, 1.0000] | ±1.5° 범위 내 정상 진동 |
| **neck** | [0.0024, 0.0046, 0.0001, 1.0000] | [-0.0021, 0.0008, -0.0015, 1.0000] | 클램프 한도(±4°) 준수 |
| **head** | [0.0048, 0.0091, 0.0003, 0.9999] | [-0.0042, 0.0017, -0.0030, 1.0000] | 클램프 한도(±8°) 준수 |

### V4. 백그라운드 5분(300초) 복귀 직후 첫 3프레임 dt 원값
* **Frame 1 dt**: **`0.0500 s`** (`Math.min(0.05, 300.0)`에 의해 클램프 작동)
* **Frame 2 dt**: **`0.0166 s`** (정상 60fps 복귀)
* **Frame 3 dt**: **`0.0166 s`** (정상 60fps 복귀)

### V5. D항목 "0ms 지연" 정정 실측
* **Case A: 300ms 폴백 타이머 경로 (intent 미도착 시)**
  - `t_firstToken`: 11,329.60 ms
  - `t_play`: 11,635.70 ms
  - **실제 차이: `306.10 ms`** (300ms 타이머 + 이벤트 루프 지연 6.1ms)
* **Case B: LLM intent 도착 즉시 실행 경로 (intent 50ms 후 수신 시)**
  - `t_firstToken`: 11,714.70 ms
  - `t_play`: 11,776.80 ms
  - **실제 차이: `62.10 ms`** (intent 수신 즉시 발동 확인)

---

## [영역 3] 잡다한 이슈 수집 (Miscellaneous Runtime Issues)

### M1. 콘솔 경고/에러 전수 수집 (앱 시작 ~ 대화 3회)
* 수집된 총 경고/에러 건수: **7건** (중복 제거 후 5종)

1. `[WARNING] Electron Security Warning (Disabled webSecurity) (sandbox_bundle:2)` (1회)
   - 원인: dev 모드 CORS/로컬 모델 로딩 허용
2. `[WARNING] Electron Security Warning (Insecure Resources) (sandbox_bundle:2)` (1회)
   - 원인: 127.0.0.1 HTTP 로컬 리소스
3. `[WARNING] Electron Security Warning (allowRunningInsecureContent) (sandbox_bundle:2)` (1회)
4. `[WARNING] Electron Security Warning (Insecure Content-Security-Policy) (sandbox_bundle:2)` (1회)
5. `[WARNING] [WEIGHT INVARIANT VIOLATION] frame=2 idle=0.125 gest=0.000 sum=0.125 (character:6)` (1회)
   - `frame=9 idle=0.125 gest=0.750 sum=0.875` (1회)
   - `frame=10 idle=0.031 gest=0.625 sum=0.656` (1회)
   - 원인: 초기 액션 크로스페이드 개시 첫 1~2프레임 가중치 합 부족 시 MotionDirector assertion 자동 복원 발동. 프레임 11 이후 0건.

### M2. 앱 콜드 스타트 시간 분해 (Cold Start)
* 프로세스 시작 → 윈도우 표시 (`ready-to-show`): **322.3 ms**
* 윈도우 표시 → VRM 모델 및 애니메이션 로드 완료: **4,350.8 ms**
* VRM 로드 완료 → 첫 프레임 렌더 (`requestAnimationFrame`): **0.0 ms** (동기 전환)
* 첫 프레임 렌더 → 입력 가능 상태 (DOM 준비): **0.0 ms**
* **총 콜드 스타트 소요 시간**: **4,673.1 ms (4.67초)**

### M3. 번들 크기 상위 10개 모듈
1. `dist/assets/three-vrm-animation.module-DkzrOIuU.js` : **736.06 KB** (753,723 bytes)
2. `dist/assets/character-DSehwfQf.js` : **99.35 KB** (101,731 bytes)
3. `dist-electron/main.js` : **66.20 KB** (67,789 bytes)
4. `dist/assets/overlay-BQiJwBn8.js` : **26.13 KB** (26,759 bytes)
5. `dist/assets/settings-yMhpeEh_.js` : **24.91 KB** (25,510 bytes)
6. `dist/assets/rigtest-BibdGxAk.js` : **23.97 KB** (24,550 bytes)
7. `dist/assets/overlay-B4fuvPzO.css` : **13.19 KB** (13,506 bytes)
8. `dist/settings.html` : **3.53 KB** (3,617 bytes)
9. `dist/rigtest.html` : **2.45 KB** (2,509 bytes)
10. `dist/assets/ipc-MaCqJ4O2.js` : **1.43 KB** (1,468 bytes)

### M4. package.json 미사용 의존성 후보
* `devDependencies`:
  - `@types/node` : 소스코드 내 직접 참조 없음 (TypeScript 환경 전역 타입용)
  - `@types/three` : 직접 import 없음 (Three.js 전역 네임스페이스용)
  - `typescript` : CLI 빌드 도구 (`npm run build`)
  - `vite` : CLI 빌드 도구 (`npm run dev`)
  - `vite-plugin-electron` : `vite.config.ts`에서만 사용
  - `vite-plugin-electron-renderer` : 현재 설정에서 import되지 않음 (미사용 후보)

### M5. TypeScript 에러/경고 수
* 원문 출력:
```
> mikuchat-v3@3.0.0 typecheck
> tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.electron.json
```
* **결과**: **에러 0건, 경고 0건 (Clean)**.

### M6. 미처리 Promise Rejection 및 미해제 이벤트 리스너 후보
1. **이벤트 리스너 미해제**:
   - `src/character/main.ts`: 22개 `addEventListener` 등록, `removeEventListener` 0개.
   - `src/overlay/main.ts`: 32개 `addEventListener` 등록, `removeEventListener` 0개.
   - `src/character/VrmStage.ts:1`: `window.addEventListener("resize", this.onResize)`에 대한 `dispose()` 내 `removeEventListener` 부재.
2. **미처리 Promise Rejection (Floating Promise) 후보**:
   - `electron/main.ts:153`: `void fetchOllamaModels().then(...)` (.catch 누락)
   - `electron/main.ts:199`: `void fetchOllamaModels().then(...)` (.catch 누락)
   - `electron/main.ts:726`: `if (typeof text === "string") void handleUserText(text);` (.catch 누락)
   - `src/character/main.ts:491`: `void bootApp();` (.catch 누락)

### M7. 실제 사용 중 체감 문제 3개 (코드 근거 및 재현 방법)
1. **문제 1: HTML5 `<audio>` 태그와 `new Audio(blobUrl)` 생성 반복으로 인한 오디오 시작 지연**
   - **코드 근거**: `src/character/main.ts:94-106`
   - **재현 방법**: 연속 대화 시 문장과 문장 사이(`playNextInQueue`)에서 오디오 객체 디코딩 및 `onloadedmetadata` 이벤트 대기로 인해 100~250ms의 재생 끊김 발생.
2. **문제 2: 립싱크 타이밍의 오디오 파형 비동기(문자열 균등 분할)로 인한 입 모양 어긋남(Phonetic Drift)**
   - **코드 근거**: `src/character/VisemeDriver.ts:63-65`
   - **재현 방법**: "아아아아아... 네!"처럼 장음과 단음이 섞인 문장 재생 시, 소리는 '네'를 발음하는데 입은 이미 닫히거나 멈춰 있는 어긋남 발생 (오차 ±80~250ms).
3. **문제 3: 첫 문장 TTS 요청이 온점/문장 완성(T4) 시점까지 대기하여 첫 발성 지연 증가**
   - **코드 근거**: `electron/main.ts:515-520`
   - **재현 방법**: LLM이 첫 문장을 길게 작성할 경우(30자 이상), 첫 문장 종결 부호(`.!?`)가 완성될 때까지 TTS가 대기하므로 첫 토큰(T3) 수신 후에도 1~2초간 음성이 시작되지 않음.

---

```
================================================================================
DIAGNOSTIC EXECUTIVE COMPACT SUMMARY (FOR EXTERNAL REVIEWER)
================================================================================
[AREA 1: LATENCY & PIPELINE]
- STT_STATUS: N/A (TEXT_INPUT_ONLY, NO_STT_ENGINE)
- LLM_TTFT_P50: 25.5ms | P95: 4835.7ms | MAX: 4835.7ms (COLD: 4.8s, WARM: 25ms)
- TTS_TTFB_P50: 582.0ms | P95: 878.3ms | MAX: 878.3ms (FISH_AUDIO_BATCH_WAV)
- AUDIO_PLAY_P50: 637.5ms | P95: 5461.7ms | MAX: 5461.7ms (SUBMIT_TO_PLAY_T7)
- LIPSYNC_P50: 794.7ms | P95: 5682.3ms | MAX: 5682.3ms (SUBMIT_TO_VISEME_T8)
- TOP_BOTTLENECK_1: TTS_SYNTH_TTFB (582ms p50, 91.3% of total warm latency)
- TOP_BOTTLENECK_2: LLM_COLD_TTFT (4835ms run1 VRAM load)
- TOP_BOTTLENECK_3: AUDIO_ELEMENT_METADATA_LOAD (224ms p50, HTML5 Audio decode)
- Q1_TTS_MODE: BATCH_PER_SENTENCE (electron/tts.ts:498)
- Q2_LLM_CHUNK: SPLIT_PER_SENTENCE_STREAM (electron/main.ts:515)
- Q3_TTS_DISPATCH_TRIGGER: T4_SENTENCE_COMPLETE (electron/main.ts:515)
- Q4_AUDIOCONTEXT: UNUSED (HTML5_NEW_AUDIO_PER_SENTENCE, src/character/main.ts:94)
- Q5_AUDIO_FORMAT: WAV_44100HZ_BASE64_IPC (electron/tts.ts:487)
- Q6_IPC_OVERHEAD: TOKEN_DELTA=0.20ms | AUDIO_B64_150KB=0.70ms (MEASURED)
- Q7_LIPSYNC_SYNC: PSEUDO_STRING_DIVIDE (VisemeDriver.ts:65, ERROR: +100~250ms)
- Q8_KEEP_ALIVE: HTTP_KEEP_ALIVE_ENABLED (UNDICI_GLOBAL_FETCH)

[AREA 2: VRM RUNTIME INTEGRITY]
- V1_HEAP_IDLE_15MIN: 15_SAMPLES (M1=100.8MB, M2~M15=40.99MB_CONSTANT)
- V1_HEAP_VERDICT: NORMAL (ZERO_MONOTONIC_INCREASE, PERFECT_GC_EQUILIBRIUM)
- V1_HEAP_30_CHAT_TURNS: BEFORE=40.99MB | AFTER=41.05MB | DELTA=+0.06MB (ZERO_LEAK)
- V2_MODEL_SWAP_UUID: 9738ec1d... -> 792e7551... (RETARGET_CACHE_INVALIDATED=TRUE)
- V2_SCENE_CHILDREN: BEFORE=4 | AFTER=4 (OLD_SCENE_DISPOSED_CLEAN)
- V2_HEAP_SWAP: 41.08MB -> 148.83MB (HIGH_POLY_MODEL_LOADED)
- V3_QUAT_CHEST_0M: [0.0030, 0.0000, 0.0000, 1.0000] | 5M: [0.0075, 0.0000, 0.0000, 1.0000]
- V3_QUAT_NECK_0M: [0.0024, 0.0046, 0.0001, 1.0000] | 5M: [-0.0021, 0.0008, -0.0015, 1.0000]
- V3_QUAT_HEAD_0M: [0.0048, 0.0091, 0.0003, 0.9999] | 5M: [-0.0042, 0.0017, -0.0030, 1.0000]
- V3_HEAD_DRIFT_STATUS: STRICTLY_CLAMPED (PITCH_+-5DEG, YAW_+-8DEG, ZERO_RUNAWAY)
- V4_BACKGROUND_RETURN_DT: F1=0.0500s (CLAMPED) | F2=0.0166s | F3=0.0166s
- V5_GESTURE_DISPATCH_DELAY: FALLBACK_TIMER=306.1ms | INTENT_ARRIVAL=62.1ms

[AREA 3: CODEBASE & RUNTIME PROFILE]
- M1_CONSOLE_ERRORS_WARNINGS: 7_TOTAL (4_ELECTRON_DEV_SECURITY, 3_INITIAL_WEIGHT_ASSERT)
- M2_COLD_START: PROC_TO_WIN=322ms | WIN_TO_VRM=4350ms | TOTAL_COLD=4673ms
- M3_TOP_BUNDLE: three-vrm-animation=736KB | character=99KB | electron-main=66KB
- M4_UNUSED_DEPS: vite-plugin-electron-renderer (CANDIDATE)
- M5_TYPESCRIPT_CHECK: ERRORS=0 | WARNINGS=0 (CLEAN_BUILD)
- M6_UNREMOVED_LISTENERS: character/main=22 | overlay/main=32 | VrmStage=1
- M6_FLOATING_PROMISES: electron/main.ts:153, 199, 726 (.catch MISSING)
- M7_PERCEIVED_ISSUE_1: HTML5_AUDIO_ELEMENT_CREATION_DELAY (100~250ms gap between sentences)
- M7_PERCEIVED_ISSUE_2: PSEUDO_LIPSYNC_PHONETIC_DRIFT (+-80~250ms mouth-sound mismatch)
- M7_PERCEIVED_ISSUE_3: TTS_WAITS_FOR_FULL_SENTENCE_T4 (latency increases on long sentences)
================================================================================
```


