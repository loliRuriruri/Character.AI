# MikuChat v3 — High-Performance Virtual AI Desktop Companion

<div align="center">

![Electron](https://img.shields.io/badge/Electron-33.4.11-47848F?style=for-the-badge&logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7.3-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-r170-black?style=for-the-badge&logo=three.js&logoColor=white)
![VRM](https://img.shields.io/badge/VRM-0.0%20%2F%201.0-FF69B4?style=for-the-badge)
![Ollama](https://img.shields.io/badge/Ollama-0.33.2-white?style=for-the-badge&logo=ollama&logoColor=black)
![PyTorch](https://img.shields.io/badge/PyTorch-CUDA%2013.4-EE4C2C?style=for-the-badge&logo=pytorch&logoColor=white)
![RTX 5090](https://img.shields.io/badge/NVIDIA-RTX%205090%2032GB-76B900?style=for-the-badge&logo=nvidia&logoColor=white)

**Windows 데스크톱 상주형 투명 3D 인공지능 캐릭터 비서 및 컴패니언**  
Three.js 기반 3D VRM 물리 연산 · 듀얼 신경망 음성 복제(VoxCPM2 & Qwen3-TTS) · 로컬 GPU 가속 롤플레잉 LLM(Gemma 4 & Qwen 3.8) · 실시간 오디오 RMS 립싱크(Lip-Sync)

[빠른 실행](#-빠른-시작-quick-start) • [시스템 아키텍처](#-시스템-아키텍처-system-architecture) • [핵심 기술 스펙](#-핵심-기능-및-기술-스펙) • [RTX 5090 벤치마크](#-rtx-5090-실측-벤치마크-결과) • [참고 자료 및 출처](#-참고-자료-공식-문서-및-리소스-출처)

</div>

---

## 📖 프로젝트 개요 (Overview)

**MikuChat v3**는 Windows 데스크톱 환경 위에 투명하게 상주하는 차세대 3D 가상 AI 컴패니언입니다.  
단순 텍스트 챗봇이나 2D 스프라이트 마스코트를 넘어, **Three.js와 `@pixiv/three-vrm` 기반의 실시간 3D 렌더링**, **초저지연 로컬 LLM 스트리밍**, 그리고 **RTX 5090 GPU 가속 신경망 음성 복제(Voice Cloning)** 기술을 유기적으로 융합했습니다.

- **완벽한 투명 윈도우 & 마우스 관통**: 캐릭터 외곽 영역은 마우스 클릭이 100% 관통되어 작업이나 게임을 방해하지 않습니다.
- **듀얼 엔진 고음질 음성 합성**: 실시간 확산 모델 `VoxCPM2`(48kHz)와 알리바바 다국어 파운데이션 모델 `Qwen3-TTS`(24kHz)를 단일 통합 보이스 프로필로 매끄럽게 전환.
- **8종 감정 제스처 & 절차적 생동감**: 대기 호흡(Idle Loop), 마우스 시선 추적(LookAt Gaze), 대화 맥락 기반 자동 제스처 트리거링.
- **한국어 반말 구어체 & 지문 분리**: 발화 대사와 지문(`*...*`)을 실시간 분리하여 채팅창엔 감성 지문을 출력하고, 음성 합성에는 순수 대사만 전달.

---

## 🏛️ 시스템 아키텍처 (System Architecture)

MikuChat-v3는 Electron의 메인 프로세스와 다중 렌더러 프로세스, 그리고 하드웨어 가속 신경망 서브프로세스로 분리된 **멀티 프로세스 IPC 파이프라인**으로 구동됩니다.

```mermaid
flowchart TB
    subgraph Desktop_UI [Windows 11 Transparent Multi-Window]
        CharWin["🎭 캐릭터 윈도우 (Character)\nThree.js 0.170 / @pixiv/three-vrm 3.5.5\n투명 WebGL 캔버스 · 립싱크 · 시선 추적"]
        OverlayWin["💬 채팅 오버레이 (Overlay)\n인라인 상태 배지 · 스트리밍 마크다운\n퀵 음성/모델 스위처"]
        SettingsWin["⚙️ 설정 & 보이스 스튜디오\n16종 음성 카탈로그 · LLM 설정 · 오디오 테스트"]
    end

    subgraph Electron_Core [Electron 33 Main Process - Node.js 22 / TypeScript 5.7]
        IPC["IPC Dispatcher & State Hub"]
        Bounds["Window Bounds Controller\nWindows DPI 좌표 팽창 방지 (setBounds)"]
        Router["Voice & TTS Engine Router\n단일 통합 보이스 프로필 매핑"]
        Demuxer["LLM Stream Demuxer\n대사/지문 분리 (StreamingActionSpanBuffer)"]
    end

    subgraph Neural_Subprocesses [RTX 5090 32GB Hardware Subprocesses]
        Ollama["🧠 Ollama 0.33.2 (Local LLM)\nQwen3.8-9B / Gemma4-12B / Gemma4-26B\n사고 토큰(<think>) 실시간 필터링"]
        VoxCPM_Proc["🎙️ VoxCPM2 Worker (PyTorch 2.6.0+cu124)\n48kHz 초고음질 신경망 보이스 복제\nSub-realtime (RTF ~0.75)"]
        Qwen_Proc["🎙️ Qwen3-TTS Worker (PyTorch 2.11.0+cu128)\n24kHz 알리바바 1.7B / 0.6B Base 모델\nJSONL 비차단 파이프 · 프롬프트 캐시"]
    end

    CharWin <-->|IPC: vrm-motion, lipsync-rms, bounds| Electron_Core
    OverlayWin <-->|IPC: chat-stream, status, quick-switch| Electron_Core
    SettingsWin <-->|IPC: get-voices, save-settings, preview| Electron_Core
    Electron_Core <-->|HTTP Streaming JSON| Ollama
    Electron_Core <-->|Stdio JSONL Pipes (UTF-8 File)| VoxCPM_Proc
    Electron_Core <-->|Stdio JSONL Pipes (UTF-8 File)| Qwen_Proc
```

---

## ⚡ 핵심 기능 및 기술 스펙

### 1. 3D VRM 렌더링 & 표정 캘리브레이션 (`@pixiv/three-vrm`)
- **표준 규격 준수**: VRM 0.0 (`HatsuneMikuNT.vrm`) 및 VRM 1.0 규격을 완벽 지원하며, `VRMUtils.rotateVRM0(vrm)` 좌표계 보정 적용.
- **표정 왜곡 & 뎁스 아티팩트 영구 차단**:
  - 볼의 원형 점선 아티팩트(`はぅ`) 및 눈 밑 음영 번짐(`下`)을 억제하고 순수 눈웃음(`[12] 笑い`)만 단독 출력.
  - 안구 및 눈썹 메시 전체에 `polygonOffset = true` (`factor: -1.0, units: -4.0`)를 부여하여 극한의 표정 변화 시에도 살에 파묻히거나 깜빡이는 Z-Fighting 현상 원천 차단.
- **실시간 오디오 RMS 립싱크 (`LipSyncBridge.ts`)**:
  - WebAudio `AudioContext`로부터 추출한 실시간 RMS 진폭을 기반으로 한글/일본어 5개 모음(`aa`, `ih`, `ou`, `ee`, `oh`) 입 모양 가중치 동적 매핑.
  - 미소(`happy`) 표정과 입 모양 발화가 충돌 없이 공존하도록 이중 버퍼 가중치 중재.

### 2. 다채로운 8종 제스처 & 모션 디렉터 (`GestureEngine.ts`)
- **표준 VRMA 모션**: `idle_loop.vrma`를 통한 자연스러운 호흡 및 미세 흔들림 상시 재생.
- **상황별 8종 키프레임 제스처**:
  - 👋 `wave`: 인사 동작
  - 🎵 `sing`: 마이크를 잡고 리듬을 타는 모션
  - ✨ `cheer`: 양손을 가슴에 모으고 기뻐하는 바운스
  - ✌️ `peace`: 깜찍한 아이돌 더블 브이 포즈
  - 🤔 `thinking`: 턱에 손을 얹고 고개를 갸우뚱하는 사색
  - 🌸 `shy`: 수줍게 손을 모으는 포즈
  - 😊 `nod`: 공감하며 고개를 끄덕이는 맞장구
  - 💬 `talk`: 이야기를 전달하는 자연스러운 손짓
- **시선 추적 (LookAt Gaze)**: 마우스 커서 위치에 따라 안구(65%), 머리(25%), 목(15%), 척추(10%)로 회전 각도를 분산하여 인체공학적 시선 이동 구현.

### 3. RTX 5090 가속 듀얼 신경망 음성 합성 (TTS)
- **완전 격리 가상환경 (Zero Environment Pollution)**:
  - `VoxCPM2`: `C:\Users\a4jud\VoxCPM\.venv` (PyTorch 2.6.0+cu124)
  - `Qwen3-TTS`: `C:\Users\a4jud\Qwen3-TTS\.venv` (PyTorch 2.11.0+cu128)
  - 두 파이썬 환경의 패키지 충돌 가능성을 100% 원천 차단.
- **단일 통합 보이스 프로필 (`VoiceReferenceAsset`)**:
  - 언어(KO/JA/EN/ZH)가 바뀌거나 엔진을 전환해도 동일한 참조 음성 및 사이드카 대본(`ref.txt`)을 자동 매핑하여 캐릭터 목소리 일관성 유지.
  - 16종의 풍부한 애니메이션 보이스 카탈로그 탑재 (`assets/tts/voices.json`).
- **노이즈 억제 & 안전 재생**:
  - 음성 파일 말미의 디퓨전 잡음 및 신음 소리를 감지/트리밍하는 `AudioTailTrimmer`.
  - 중복 발화나 연속 클릭 시 이전 오디오를 즉각 정지하고 큐를 안전하게 비우는 `AudioStopRace` 토큰 가드.

### 4. 고지능 캐릭터 롤플레잉 LLM 파이프라인
- **Ollama 기반 로컬 GPU 추론**:
  - `Qwen3.8-9B-heretic`: 1.69초 초저지연, 204 tps, 검열 제로의 즉답 모드.
  - `gemma4:12b-heretic-styletune` (Q6_K): 10GB, 최고 수준의 문학적 묘사와 감정선.
  - `gemma4:26b-styletune-v2` (Q4_K_M): 17GB, RTX 5090 32GB VRAM을 풀 활용(피크 30.5GB)하는 최상급 한국어 공감 대화.
- **스트리밍 대사/지문 실시간 분리 (`StreamingActionSpanBuffer`)**:
  - 모델이 생성하는 `*기쁜 표정으로 웃으며*` 등의 지문 텍스트는 오버레이 채팅창에만 예쁘게 표시되고, TTS 음성 엔진으로는 전달되지 않아 시스템 프롬프트 지문이 소리 내어 읽히는 문제 원천 방지.
- **사고 토큰(`thinking`) 분리 표시**:
  - Gemma 4 및 Qwen 3.8의 `<think>` 블록을 실시간 파싱하여 채팅창 상단에 비간섭 플렉스 배지로 표시.

### 5. 데스크톱 UI/UX 완성도
- **Windows DPI 좌표 팽창 버그 완전 해결**:
  - 고DPI 디스플레이에서 캐릭터 드래그 시 창 크기가 440x580에서 990x1110으로 기하급수적으로 팽창하던 Chromium 내부 버그를 원자적 `setBounds` 호출로 영구 수정.
- **채팅 메시지 가림 방지 플렉스 상태 바**:
  - "생각 중…", "음성 합성 중…" 플로팅 배지가 최신 대화를 가리지 않도록 채팅창 하단에 동적 높이 플렉스 행으로 재배치.
- **원클릭 퀵 스위처**: 채팅 오버레이 헤더 드로어에서 LLM 모델과 TTS 음성 엔진을 즉시 변경 가능.

---

## 📊 RTX 5090 실측 벤치마크 결과

> **하드웨어 사양**: AMD Ryzen / NVIDIA GeForce RTX 5090 (32GB GDDR7, sm_120) / Windows 11 Pro 64-bit  
> **측정 환경**: 50회 연속 실측(Global Warmup 제외), MikuChat-v3 실제 런타임 조건  

### 1. TTS 엔진 성능 비교 (50 Validated Runs)

| 측정 항목 | VoxCPM2 (48,000 Hz) | Qwen3-TTS 1.7B-Base (24,000 Hz) | Qwen3-TTS 0.6B-Base (Fast Mode) |
| :--- | :---: | :---: | :---: |
| **평균 첫 발화 지연 (Mean TTFA)** | **4.335s** | **8.039s** | **8.193s** |
| **중앙값 첫 발화 지연 (Median TTFA)** | **4.714s** | **8.182s** | **8.204s** |
| **p95 지연 시간 (Tail Latency)** | **8.349s** | **14.156s** | **16.320s** |
| **평균 실시간 계수 (Mean RTF)** | **0.757** (Sub-realtime) | **1.523** | **1.457** |
| **RTX 5090 VRAM 점유량** | ~3.8 GB | ~4.45 GB | ~2.1 GB |
| **프롬프트 캐시 조회 속도** | N/A (Diffusion) | **< 0.0005s (0.5ms)** | **< 0.0005s (0.5ms)** |
| **LLM 동시 생성 시 감속** | -23.2% (버스트 편차) | **+1.3%** (극히 안정적) | +56.7% |

### 2. LLM 롤플레잉 모델 비교 (RTX 5090 Ollama)

| 모델명 | 양자화 / 크기 | VRAM 피크 | 첫 대사 지연 (Speech TTFT) | 생성 속도 (Total TPS) | 지문 포맷 준수율 (`*지문*`) | 캐릭터 페르소나 및 한국어 뉘앙스 |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **`Qwen3.8-9B-fast`** | 5.2 GB | ~18.6 GB | **938.8 ms** | **203.4 tps** | 4/5 (1회 루프) | 반응속도 최고, 가벼운 잡담에 적합 |
| **`Qwen3.8-9B-heretic`** | 5.2 GB | ~18.5 GB | **1,696.1 ms** | **204.6 tps** | **5/5 (100%)** | **Fast RP 추천**: 검열/거절 제로, 친근한 반말 구어체 |
| **`gemma4:12b`** (순정) | 7.6 GB | ~27.2 GB | 4,293.6 ms | 115.5 tps | 3/5 | 내부 사고 토큰 소모로 대사 잘림 발생 |
| **`gemma4:12b-heretic-styletune`** | 10.0 GB (Q6_K) | ~27.1 GB | **3,609.5 ms** | **109.5 tps** | **5/5 (100%)** | **Literary RP 추천**: 문학적 감정 묘사 최상급 |
| **`gemma4:26b`** (순정) | 17.0 GB | ~26.4 GB | 2,905.3 ms | 209.4 tps | 2/5 | 512 토큰 제한 하에서 사고 토큰 과소모 |
| **`gemma4:26b-styletune-v2`** | 17.0 GB (Q4_K_M) | **~30.5 GB** | **4,129.8 ms** | **141.5 tps** | 3/5 (품질 우수) | **Balanced RP 추천**: 32GB VRAM 풀활용, 최상급 공감 대사 |

---

## 📚 참고 자료, 공식 문서 및 리소스 출처

MikuChat-v3 개발에 참조 및 활용된 주요 오픈소스 프로젝트, 표준 문서, 모델 및 데이터셋 출처 목록입니다.

### 1. 3D 그래픽스 & VRM 생태계
- **Pixiv three-vrm**: [https://github.com/pixiv/three-vrm](https://github.com/pixiv/three-vrm)
  - VRM 0.0/1.0 로더, 휴머노이드 노멀라이즈드 본 매핑, MToon 셰이더 머티리얼.
- **Pixiv three-vrm-animation**: [https://github.com/pixiv/three-vrm/tree/dev/packages/three-vrm-animation](https://github.com/pixiv/three-vrm/tree/dev/packages/three-vrm-animation)
  - VRMC_vrm_animation 클립 변환기 및 `createVRMAnimationClip` API.
- **VRM 공식 컨소시엄 규격**: [https://vrm.dev/](https://vrm.dev/)
  - VRM 휴머노이드 골격 사양 및 블렌드셰이프/익스프레션 표준 명세.
- **VRM Animation 1.0 사양 (VRMC_vrm_animation)**: [https://github.com/vrm-c/vrm-specification](https://github.com/vrm-c/vrm-specification/tree/master/specification/VRMC_vrm_animation-1.0)
- **Three.js 공식 문서**: [https://threejs.org/docs/](https://threejs.org/docs/)
  - `THREE.AnimationMixer`, `AnimationAction.crossFadeTo`, `WebGLRenderer`.
- **ChatVRM (Pixiv)**: [https://github.com/pixiv/ChatVRM](https://github.com/pixiv/ChatVRM)
  - 웹 기반 VRM 대화형 AI 컴패니언 아키텍처 및 립싱크 참조.
- **Warudo VTuber Suite**: [https://docs.warudo.app/](https://docs.warudo.app/)
  - 다층 모션 레이어링(Base Mocap + Dynamic Overlay + Gaze + SpringBone Physics) 구조 참조.
- **VRoid Studio**: [https://vroid.com/en/studio](https://vroid.com/en/studio)
- **Adobe Mixamo**: [https://www.mixamo.com/](https://www.mixamo.com/)

### 2. 신경망 음성 합성 (TTS) & 음성 복제
- **VoxCPM / VoxCPM2**: [https://github.com/Tavus/VoxCPM](https://github.com/Tavus/VoxCPM) / OpenBMB
  - 48kHz 실시간 디퓨전 음성 복제 모델.
- **Alibaba Qwen3-TTS**: [https://github.com/QwenLM/Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)
  - [Qwen/Qwen3-TTS-12Hz-1.7B-Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base)
  - [Qwen/Qwen3-TTS-12Hz-0.6B-Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base)
- **Fish Audio / Fish Speech**: [https://github.com/fishaudio/fish-speech](https://github.com/fishaudio/fish-speech)
- **Voice-Design-Cloner**: 애니메이션 음성 데이터셋 LoRA 추출 및 전처리 파이프라인.

### 3. LLM, 롤플레잉 모델 & 백엔드
- **Ollama**: [https://github.com/ollama/ollama](https://github.com/ollama/ollama)
  - 로컬 GGUF 모델 고속 추론 서빙.
- **mradermacher Gemma 4 Fine-tunes (Hugging Face)**:
  - [gemma-4-12b-heretic-styletune-head-GGUF](https://huggingface.co/mradermacher/gemma-4-12b-heretic-styletune-head-GGUF)
  - [Gemma-4-26B-A4B-StyleTune-V2-GGUF](https://huggingface.co/mradermacher/Gemma-4-26B-A4B-StyleTune-V2-GGUF)
- **Google Gemini API**: [https://ai.google.dev/](https://ai.google.dev/)
- **Electron**: [https://github.com/electron/electron](https://github.com/electron/electron)
- **Vite**: [https://github.com/vitejs/vite](https://github.com/vitejs/vite)
- **aria2c**: [https://github.com/aria2/aria2](https://github.com/aria2/aria2)

---

## 📁 프로젝트 폴더 구조 (Project Structure)

```text
C:\TEST\MikuChat-v3\
├── assets/
│   └── tts/
│       ├── voices.json                 # 16종 보이스 카탈로그 메타데이터
│       ├── my_voice_ref.wav            # 하츠네 미쿠 기본 참조 음성 (44.1kHz Mono, 10.16s)
│       ├── my_voice_ref.txt            # 참조 음성 사이드카 대본
│       └── voices/                     # 개별 보이스 음원 디렉토리 (ref.wav, ref.txt)
├── docs/
│   ├── PROJECT_SPEC_AND_REFERENCES.md  # 상세 기술 백서 및 전체 레퍼런스
│   ├── NAMUWIKI.md                     # 프로젝트 엔터테인먼트 위키 문서
│   ├── audio/                          # WebAudio 파이프라인 문서
│   ├── voice/                          # Qwen3-TTS 및 VoxCPM 상세 벤치마크
│   └── vrm-motion/                     # VRM 3D 모션 & 제스처 리서치 리포트
├── electron/
│   ├── main.ts                         # Electron 메인 프로세스 (윈도우 라이프사이클, DPI 방어)
│   ├── llm.ts                          # Ollama / Gemini / OpenAI 스트리밍 클라이언트
│   ├── tts.ts                          # VoxCPM2 / Qwen3 / FishAudio 통합 라우터
│   ├── qwenTts.ts                      # Qwen3-TTS 백그라운드 워커 서브프로세스 어댑터
│   └── voices.ts                       # 보이스 카탈로그 로더 및 검증기
├── public/
│   └── models/
│       ├── HatsuneMikuNT.vrm           # 하츠네 미쿠 VRM 0.0 메인 캐릭터 모델
│       ├── idle_loop.vrma              # 표준 VRMA 대기 루프 모션
│       └── [기타 VRM 아바타들]
├── scripts/
│   ├── qwen3_tts_worker.py             # Qwen3-TTS 비차단 지속형 JSONL 워커
│   └── benchmark_gemma_rp_comparison.py# RTX 5090 LLM 6종 벤치마크 스크립트
├── src/
│   ├── character/                      # 3D VRM 렌더러 프로세스
│   │   ├── VrmStage.ts                 # Three.js 씬, 조명, 셰이더, VRM 로더
│   │   ├── GestureEngine.ts            # 8종 키프레임 제스처 & 대기 애니메이션
│   │   ├── LipSyncBridge.ts            # RMS 기반 오디오-입모양 바인딩
│   │   └── main.ts                     # 캐릭터 윈도우 인터랙션 (드래그, 줌, 시선)
│   ├── overlay/                        # 채팅 오버레이 UI
│   │   ├── main.ts                     # 채팅 스트리밍 렌더러, 퀵 스위처
│   │   └── overlay.css                 # 투명 플렉스 레이아웃 스타일시트
│   ├── settings/                       # 설정 대시보드
│   └── shared/                         # 공통 타입 및 인터페이스 명세
├── tests/                              # 18개 자동화 단위/통합 테스트 스위트
├── package.json                        # 종속성 고정 명세
└── start_v3.bat                        # 원클릭 프로덕션 실행 배치 파일
```

---

## 🚀 빠른 시작 (Quick Start)

### 1. 요구 사항 (Prerequisites)
- **OS**: Windows 10 / 11 (64-bit)
- **Node.js**: `v20.0.0` 이상 (Node.js 22 LTS 권장)
- **GPU**: NVIDIA 그래픽카드 (RTX 3060 이상 권장, RTX 5090 최적화)
- **Ollama**: [Ollama 공식 웹사이트](https://ollama.com/) 설치 후 서비스 실행

### 2. 설치 및 빌드
```powershell
# 저장소 클론 후 루트 디렉토리 이동
cd C:\TEST\MikuChat-v3

# Node.js 종속성 패키지 설치
npm install

# 18개 정규 테스트 스위트 무결성 검증
npm test

# 프로덕션 빌드 (Vite 번들링 & Electron 컴파일)
npm run build
```

### 3. 애플리케이션 실행
```powershell
# 개발 모드로 실행
npm run dev

# 또는 배포 빌드 실행
.\start_v3.bat
```

---

## 🧪 정규 테스트 스위트 (18/18 PASS)

MikuChat-v3는 전 모듈에 걸쳐 **18개의 정규 테스트 스위트**를 완비하고 있으며, `npm test`를 통해 즉각적인 무결성을 검증합니다.

```powershell
==================================================
       MikuChat-v3 Formal Test Suite Runner       
==================================================
-> Running tests/response-parser.test.ts          ✓ ResponseParser tests passed.
-> Running tests/streaming-action-buffer.test.ts  ✓ StreamingActionSpanBuffer tests passed.
-> Running tests/gesture-mapping.test.ts          ✓ GestureMapping tests passed.
-> Running tests/dynamic-context.test.ts          ✓ DynamicContext tests passed.
-> Running tests/memory-manager.test.ts           ✓ MemoryManager tests passed.
-> Running tests/scene-state.test.ts             ✓ SceneState tests passed.
-> Running tests/prompt-composer.test.ts         ✓ PromptComposer tests passed.
-> Running tests/provider-health.test.ts         ✓ ProviderHealth tests passed.
-> Running tests/audio-rms.test.ts               ✓ AudioRms tests passed.
-> Running tests/audio-stop-race.test.ts         ✓ AudioStopRace tests passed (10/10 PASS).
-> Running tests/audio-queue-cadence.test.ts     ✓ AudioQueueCadence tests passed (gaps: 0).
-> Running tests/motion-director-clamp.test.ts   ✓ MotionDirector clamp & mocap tests passed.
-> Running tests/lipsync-bridge.test.ts          ✓ LipSync Bridge tests passed.
-> Running tests/audio-tail-trimmer.test.ts      ✓ AudioTailTrimmer tests passed.
-> Running tests/voice-favorites.test.ts         ✓ Voice favorites and ranking tests passed.
-> Running tests/voice-profile.test.ts           ✓ Unified Single Voice Profile tests passed.
-> Running tests/qwen3-tts.test.ts               ✓ Qwen3-TTS Integration tests passed.
-> Running tests/window-bounds-drag.test.ts      ✓ Window Bounds & Drag Invariant tests passed.
==================================================
Test Summary: 18 passed, 0 failed out of 18 suites.
==================================================
🎉 ALL FORMAL TEST SUITES PASSED CLEANLY!
```

---

## 📜 라이선스 및 크레딧 (License & Credits)

- **소프트웨어 코어**: MikuChat-v3 Proprietary / Dual MIT Engine Pipeline.
- **3D 아바타 (Hatsune Miku)**: 캐릭터 하츠네 미쿠는 Crypton Future Media, INC.의 등록 상표입니다. 본 프로젝트는 비상업적 팬 창작 가이드라인(Piapro Character License)을 준수합니다.
- **VRM 생태계**: Pixiv Inc. (`@pixiv/three-vrm`, `@pixiv/three-vrm-animation`).
- **음성 합성**: OpenBMB (VoxCPM), Alibaba Group (QwenLM / Qwen3-TTS).
