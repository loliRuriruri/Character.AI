import "./overlay.css";
import { Ipc } from "../shared/ipc";
import { stripEmotionTags } from "../shared/emotion";
import { isLikelyActionProse, QUIZ_OR_INSTRUCTION_REGEX } from "../core/response/ResponseParser";
import { stripChineseHallucinations } from "../core/response/TtsSanitizer";
import type { AppSettings, TtsStatus, GestureName, SrsCard, ChatMode, EmotionName, ProviderHealthStatus } from "../shared/types";

const root = document.getElementById("root")!;
root.innerHTML = `
<div id="shell">
  <!-- Clean Header with Segmented Tabs & Icon Tools (Never Clips!) -->
  <header class="chat-header">
    <div class="header-left">
      <span class="brand-title">✨ AI 캐릭터챗</span>
    </div>

    <!-- Mode Tabs: 3 Buttons (대화 / RP / 튜터) -->
    <div class="mode-tabs no-drag">
      <button id="tab-free" type="button" class="tab-btn active" title="일상 자유 대화 모드">🗣️ 대화</button>
      <button id="tab-rp" type="button" class="tab-btn" title="행동 서술 및 롤플레잉 모드">🎭 RP</button>
      <button id="tab-tutor" type="button" class="tab-btn" title="일본어/외국어 문법 및 표현 교정 튜터 모드">📚 튜터</button>
    </div>

    <span class="spacer"></span>

    <!-- Expandable Feature Tabs & Essential Tools (Never Clips!) -->
    <div class="tool-cluster no-drag">
      <!-- 1. Expandable Model Pill: 클릭 시 AI 모델/보이스 드로어 확장 -->
      <button id="btn-toggle-modelbar" type="button" class="icon-pill" title="AI 두뇌 모델 & 캐릭터 목소리 설정 열기">
        ⚡ <span id="hdr-active-model">Qwen</span> ▾
      </button>

      <!-- 2. Expandable Motion & Quick Tools Pill: 클릭 시 제스처/모션 & 음소거/비우기 확장 -->
      <button id="btn-toggle-gestures" type="button" class="icon-tool gestures-tool" title="모션 리액션 및 도구 (음소거, 초기화) 열기">
        🎭 ▾
      </button>

      <!-- 3. Permanent Settings Gear: 항상 직접 노출! -->
      <button id="btn-settings" type="button" class="icon-tool settings-tool" title="환경설정 열기 (단축키, 보이스 스튜디오, AI 엔진)">⚙️</button>

      <!-- 4. Permanent Close: 항상 직접 노출! -->
      <button id="btn-hide" type="button" class="icon-tool close-tool" title="채팅창 최소화 (캐릭터 더블클릭 시 복원)">✕</button>
    </div>
  </header>

  <!-- Quick Model & Voice Selector Drawer -->
  <div id="model-drawer" class="model-drawer no-drag" style="display:none;">
    <div class="drawer-header">
      <span style="color:#39c5bb; font-weight:800; font-size:11px;">⚡ AI 두뇌 모델 & 캐릭터 보이스 즉시 변경</span>
      <button id="btn-close-modelbar" type="button" class="sug-tool-btn close-sug">✕ 닫기</button>
    </div>
    <div class="model-quick-grid" style="grid-template-columns: 1fr 1fr 1.1fr; gap:6px;">
      <div class="quick-field">
        <label class="quick-label">🤖 LLM 대화 모델</label>
        <select id="quick-llm-select" class="quick-select"></select>
      </div>
      <div class="quick-field">
        <label class="quick-label">🔊 음성 엔진</label>
        <select id="quick-tts-prov" class="quick-select">
          <option value="voxcpm">🚀 VoxCPM2 (로컬 감우/아야카)</option>
          <option value="qwen3tts">🤖 Qwen3-TTS 1.7B (로컬)</option>
          <option value="fish">🐟 Fish Audio (클라우드 미쿠)</option>
          <option value="irodori">🇯🇵 Irodori-TTS (일본어)</option>
          <option value="web">🔊 시스템 기본 음성</option>
        </select>
      </div>
      <div class="quick-field" id="quick-voice-field">
        <label class="quick-label">🎙️ 캐릭터 목소리</label>
        <div style="display:flex; gap:3px; align-items:center;">
          <select id="quick-voice-select" class="quick-select" style="flex:1;"></select>
          <button id="btn-quick-preview" type="button" class="quick-preview-btn" title="선택한 목소리 샘플 듣기">▶</button>
        </div>
      </div>
    </div>
    <div class="quick-status-msg" style="display:flex; justify-content:space-between; align-items:center;">
      <span>현재: <b id="lbl-cur-llm" style="color:#39c5bb;">qwen2.5:14b</b> / <b id="lbl-cur-voice" style="color:#ff6b8a;">아야카</b></span>
      <button id="btn-open-settings-studio" type="button" class="sug-tool-btn" style="color:#ff8ba7; border-color:rgba(255,139,167,0.3); background:rgba(255,139,167,0.1); font-size:10px; padding:2px 8px; cursor:pointer;">🎙️ 새 보이스 제작</button>
    </div>
  </div>

  <!-- Expandable Gestures & Quick Tools Drawer (Accordion) -->
  <div id="gestures-drawer" class="drawer-panel no-drag" style="display:none;">
    <div class="drawer-header">
      <span>🎭 MIKU 제스처 모션 & 빠른 도구</span>
      <button id="btn-close-gestures" type="button" class="sug-tool-btn close-sug">✕ 닫기</button>
    </div>
    <div class="drawer-grid">
      <button class="gesture-btn" data-gesture="wave">👋 인사</button>
      <button class="gesture-btn" data-gesture="nod">😊 끄덕</button>
      <button class="gesture-btn" data-gesture="explain">💬 설명</button>
      <button class="gesture-btn" data-gesture="laugh">😄 웃음</button>
      <button class="gesture-btn" data-gesture="think">🤔 생각</button>
    </div>
    <div class="gestures-quickbar">
      <button id="btn-mute" type="button" class="drawer-action-btn" title="음소거 켜기/끄기">🔊 음소거</button>
      <button id="btn-clear" type="button" class="drawer-action-btn danger" title="대화 기록 비우기 (초기화)">🧹 대화 비우기</button>
      <button id="btn-open-settings" type="button" class="drawer-action-btn accent" title="전체 환경설정 열기">⚙️ 환경설정</button>
    </div>
  </div>

  <!-- Tutor Sub-bar (Displayed when in Tutor Mode) -->
  <div id="tutor-bar" class="tutor-subbar no-drag" style="display:none;">
    <div class="tutor-info">
      <span class="tutor-badge">TUTOR</span>
      <span class="tutor-text">외국어 문법 교정 & 단어장 자동 수집 중</span>
    </div>
    <button id="btn-vocab" type="button" class="vocab-pill" title="단어장 및 망각곡선 퀴즈 열기">
      📖 단어장 (<span id="vocab-due-count">0</span>)
    </button>
  </div>

  <div id="error"></div>
  <div id="chat-container">
    <div id="log"></div>
    <div id="status-floating-wrap" class="status-floating-wrap no-drag">
      <span id="status-badge" class="status-pill ready">🟢 준비</span>
    </div>
  </div>
  <!-- Smart Suggestion Bar (Zero-Scrollbar, 3-Pill Balanced Layout) -->
  <div id="suggestions-bar" class="suggestions-wrapper no-drag">
    <div class="sug-header">
      <span class="sug-label">💡 추천 대화 질문</span>
      <div class="sug-actions">
        <button id="btn-shuffle-sug" type="button" class="sug-tool-btn" title="다른 추천 질문 보기">🔄 새로고침</button>
        <button id="btn-close-sug" type="button" class="sug-tool-btn close-sug" title="추천 바 숨기기">✕</button>
      </div>
    </div>
    <div id="suggestions-chips" class="sug-chips-row"></div>
  </div>

  <div id="composer" class="no-drag">
    <div id="input-row">
      <textarea id="input" placeholder="미쿠에게 말하기… (Enter 전송, Shift+Enter 줄바꿈)"></textarea>
    </div>
    <div id="action-row">
      <div class="action-left">
        <button id="btn-toggle-sug" type="button" class="active" title="추천 대화 질문 열기/닫기">💡 추천</button>
        <button id="btn-mouse" type="button" title="마우스 커서 위치 분석 (단축키: F9)">🎯 마우스</button>
        <button id="btn-screen" type="button" title="전체 화면 캡처 분석">📸 화면</button>
        <button id="ptt" type="button" title="누르고 있는 동안 음성인식">🎙️ PTT</button>
      </div>
      <button id="send" type="button">전송 ➔</button>
    </div>
  </div>

  <!-- SRS Vocabulary Modal -->
  <div id="vocab-modal" style="display:none; position:absolute; inset:0; background:rgba(10,18,28,0.96); z-index:50; flex-direction:column; padding:12px; backdrop-filter:blur(16px);">
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(57,197,187,0.3); padding-bottom:8px;">
      <span style="font-weight:700; color:#39c5bb; font-size:13px;">📖 미쿠의 일본어/외국어 단어장 (SRS)</span>
      <button id="btn-close-vocab" type="button">닫기 (X)</button>
    </div>
    
    <!-- Flashcard Quiz Section -->
    <div id="quiz-box" style="margin-top:10px; background:rgba(15,30,42,0.8); border:1px solid rgba(57,197,187,0.3); border-radius:12px; padding:12px; text-align:center;">
      <div style="font-size:10px; color:#8aa8b0; margin-bottom:4px;">🎯 오늘 복습할 단어 퀴즈</div>
      <div id="quiz-word" style="font-size:18px; font-weight:800; color:#e8fbff; margin:6px 0;">단어 불러오는 중…</div>
      <div id="quiz-answer" style="display:none; margin:8px 0; padding:8px; background:rgba(0,0,0,0.3); border-radius:8px;">
        <div id="quiz-reading" style="font-size:12px; color:#39c5bb;"></div>
        <div id="quiz-meaning" style="font-size:13px; font-weight:700; color:#fff; margin-top:2px;"></div>
      </div>
      <div id="quiz-action-bar" style="margin-top:8px;">
        <button id="btn-show-ans" type="button" style="background:#39c5bb; color:#071318; font-weight:700;">정답 보기</button>
        <div id="quiz-grades" style="display:none; gap:6px; justify-content:center;">
          <button class="btn-grade" data-grade="1" style="background:rgba(255,107,138,0.2); border-color:#ff6b8a; color:#ff6b8a;">❌ 틀림</button>
          <button class="btn-grade" data-grade="2" style="background:rgba(255,180,50,0.2); border-color:#ffb432; color:#ffb432;">⚠️ 어려움</button>
          <button class="btn-grade" data-grade="3" style="background:rgba(57,197,187,0.2); border-color:#39c5bb; color:#39c5bb;">⭕ 기억남</button>
          <button class="btn-grade" data-grade="4" style="background:rgba(100,255,150,0.2); border-color:#64ff96; color:#64ff96;">⭐ 쉬움</button>
        </div>
      </div>
    </div>

    <!-- Word List -->
    <div style="margin-top:10px; font-size:11px; color:#8aa8b0; font-weight:700;">저장된 단어 목록</div>
    <div id="vocab-list" style="flex:1; overflow-y:auto; margin-top:6px; display:flex; flex-direction:column; gap:6px;"></div>
  </div>
</div>
`;

const logEl = document.getElementById("log")!;
const errorEl = document.getElementById("error")!;

function setStatus(text: string, type: "ready" | "loading" | "thinking" | "synthesizing" | "speaking" | "listening" = "ready"): void {
  const badge = document.getElementById("status-badge");
  const wrap = document.getElementById("status-floating-wrap");
  if (badge) {
    badge.className = `status-pill ${type} no-drag`;
    badge.textContent = text;
  }
  if (wrap) {
    const wasActive = wrap.classList.contains("active");
    if (type === "ready") {
      wrap.classList.remove("active");
    } else {
      wrap.classList.add("active");
      if (!wasActive && logEl) {
        logEl.scrollTop = logEl.scrollHeight;
      }
    }
  }
}

const inputEl = document.getElementById("input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;
const pttBtn = document.getElementById("ptt") as HTMLButtonElement;
const btnSettings = document.getElementById("btn-settings")!;
const btnMute = document.getElementById("btn-mute") as HTMLButtonElement;
const btnClear = document.getElementById("btn-clear")!;
const btnHide = document.getElementById("btn-hide") as HTMLButtonElement;

// Mode Tabs & Drawer Controls
const tabFree = document.getElementById("tab-free") as HTMLButtonElement;
const tabRp = document.getElementById("tab-rp") as HTMLButtonElement;
const tabTutor = document.getElementById("tab-tutor") as HTMLButtonElement;
const tutorBar = document.getElementById("tutor-bar") as HTMLDivElement;
const btnToggleGestures = document.getElementById("btn-toggle-gestures") as HTMLButtonElement;
const gesturesDrawer = document.getElementById("gestures-drawer") as HTMLDivElement;
const btnCloseGestures = document.getElementById("btn-close-gestures") as HTMLButtonElement | null;
const btnOpenSettings = document.getElementById("btn-open-settings") as HTMLButtonElement | null;

// Quick Model & Voice Drawer Controls
const btnToggleModelbar = document.getElementById("btn-toggle-modelbar") as HTMLButtonElement;
const modelDrawer = document.getElementById("model-drawer") as HTMLDivElement;
const btnCloseModelbar = document.getElementById("btn-close-modelbar") as HTMLButtonElement;
const quickLlmSelect = document.getElementById("quick-llm-select") as HTMLSelectElement;
const quickTtsProv = document.getElementById("quick-tts-prov") as HTMLSelectElement;
const quickVoiceSelect = document.getElementById("quick-voice-select") as HTMLSelectElement;
const btnQuickPreview = document.getElementById("btn-quick-preview") as HTMLButtonElement;
const btnOpenSettingsStudio = document.getElementById("btn-open-settings-studio") as HTMLButtonElement | null;

const hdrActiveModel = document.getElementById("hdr-active-model")!;
const hdrActiveVoice = document.getElementById("hdr-active-voice");
const lblCurLlm = document.getElementById("lbl-cur-llm")!;
const lblCurVoice = document.getElementById("lbl-cur-voice")!;

let cachedVoiceCatalog: { id: string; displayName: string }[] = [];

const FISH_VOICE_PRESETS = [
  { id: "acc8237220d8470985ec9be6c4c480a9", name: "🎵 미쿠 (글로벌)" },
  { id: "6717a74323274cb296ea9a0da654c977", name: "🇯🇵 미쿠 (일본어)" },
  { id: "5ac6fb7171ba419190700620738209d8", name: "⚡ 라이덴 쇼군" },
  { id: "bd08be872bc440918674af072944ba12", name: "💧 후리나" },
  { id: "4858e0be678c4449bf3a7646186edd42", name: "🌱 나히다" },
  { id: "2879aac2931e450f8159d2f65cd918f4", name: "🔥 호두" },
  { id: "7c0ab8e2b1714ce3a80f2622a5cc459c", name: "🌸 반디 (Firefly)" },
  { id: "4c0be7e14fa24928b4f2541ca49b57d0", name: "🕷️ 카프카" },
  { id: "ce8248e10ec54d509f75945ad58ccfb6", name: "⚔️ 프리렌" },
  { id: "6eef1184091d4e96aceb90b4681a5400", name: "🎸 봇치" },
  { id: "ffe41701970d4b339ef7906300716f99", name: "🥜 아냐" },
  { id: "088d160c978f4e8ba98701af1f58f842", name: "🌸 아로나" },
];

const IRODORI_LORA_PRESETS = [
  { id: "Nilou3000", name: "🌸 닐루 (Nilou)" },
  { id: "Furina", name: "💧 푸리나 (Furina)" },
  { id: "HuTao", name: "🔥 호두 (Hu Tao)" },
  { id: "Miku_JP", name: "🎵 미쿠 (일본어)" },
];

function populateQuickVoices(provider: string): void {
  if (!quickVoiceSelect) return;
  quickVoiceSelect.innerHTML = "";
  if (provider === "qwen3tts") {
    const curRef = (currentAppSettings?.qwen3ReferenceWav || currentAppSettings?.voxcpmReferenceWav || currentAppSettings?.ttsVoiceId || "my_voice_03").trim();
    let found = false;

    // Standard voices from catalog (shared reference assets)
    cachedVoiceCatalog.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = `🤖 ${v.displayName} (${v.id})`;
      if (v.id === curRef) {
        opt.selected = true;
        found = true;
      }
      quickVoiceSelect.appendChild(opt);
    });

    if (!found && curRef) {
      const opt = document.createElement("option");
      opt.value = curRef;
      const baseName = curRef.split(/[\\/]/).pop() || curRef;
      opt.textContent = `🤖 커스텀 (${baseName})`;
      opt.selected = true;
      quickVoiceSelect.prepend(opt);
    }
    quickVoiceSelect.value = curRef;
  } else if (provider === "fish") {
    const curFishId = (currentAppSettings?.fishVoiceId || "acc8237220d8470985ec9be6c4c480a9").trim();
    let found = false;

    const favs = currentAppSettings?.fishFavorites || [];
    if (favs.length > 0) {
      const favGroup = document.createElement("optgroup");
      favGroup.label = "⭐ 내 즐겨찾기 보이스";
      favs.forEach((item) => {
        const opt = document.createElement("option");
        opt.value = item.id;
        opt.textContent = `⭐ ${item.title}`;
        if (item.id === curFishId) {
          opt.selected = true;
          found = true;
        }
        favGroup.appendChild(opt);
      });
      quickVoiceSelect.appendChild(favGroup);
    }

    const presetGroup = document.createElement("optgroup");
    presetGroup.label = "🎵 기본 프리셋";
    FISH_VOICE_PRESETS.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.name;
      if (item.id === curFishId) {
        opt.selected = true;
        found = true;
      }
      presetGroup.appendChild(opt);
    });
    quickVoiceSelect.appendChild(presetGroup);

    if (!found && curFishId) {
      const opt = document.createElement("option");
      opt.value = curFishId;
      opt.textContent = `⭐ 커스텀 (${curFishId.substring(0, 8)}…)`;
      opt.selected = true;
      quickVoiceSelect.prepend(opt);
    }
    quickVoiceSelect.value = curFishId;
  } else if (provider === "irodori") {
    const curLora = currentAppSettings?.irodoriLoraId || "Nilou3000";
    IRODORI_LORA_PRESETS.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.name;
      if (item.id === curLora) opt.selected = true;
      quickVoiceSelect.appendChild(opt);
    });
    quickVoiceSelect.value = curLora;
  } else if (provider === "web") {
    const opt = document.createElement("option");
    opt.value = "web_default";
    opt.textContent = "🔊 Windows 기본 음성 (Web Speech)";
    opt.selected = true;
    quickVoiceSelect.appendChild(opt);
    quickVoiceSelect.value = "web_default";
  } else {
    const curVoice = currentAppSettings?.ttsVoiceId || "my_voice_03";
    cachedVoiceCatalog.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = `${v.displayName} (${v.id})`;
      if (v.id === curVoice) opt.selected = true;
      quickVoiceSelect.appendChild(opt);
    });
    quickVoiceSelect.value = curVoice;
  }
}

let currentAppSettings: AppSettings | null = null;
let quickPreviewAudio: HTMLAudioElement | null = null;

// Toggle Model Bar (Accordion: closes Gestures)
btnToggleModelbar.addEventListener("click", () => {
  const isHidden = modelDrawer.style.display === "none";
  modelDrawer.style.display = isHidden ? "flex" : "none";
  btnToggleModelbar.classList.toggle("active", isHidden);
  if (isHidden) {
    window.miku.send(Ipc.GET_OLLAMA_MODELS);
    if (quickTtsProv && currentAppSettings) {
      quickTtsProv.value = currentAppSettings.ttsProvider || "voxcpm";
    }
    populateQuickVoices(currentAppSettings?.ttsProvider || "voxcpm");
    updateModelVoiceLabels();
    gesturesDrawer.style.display = "none";
    btnToggleGestures.classList.remove("active");
  }
});

btnCloseModelbar.addEventListener("click", () => {
  modelDrawer.style.display = "none";
  btnToggleModelbar.classList.remove("active");
});

// Toggle Gestures & Quick Tools (Accordion: closes Model Bar)
btnToggleGestures.addEventListener("click", () => {
  const isHidden = gesturesDrawer.style.display === "none";
  gesturesDrawer.style.display = isHidden ? "flex" : "none";
  btnToggleGestures.classList.toggle("active", isHidden);
  if (isHidden) {
    modelDrawer.style.display = "none";
    btnToggleModelbar.classList.remove("active");
  }
});

btnCloseGestures?.addEventListener("click", () => {
  gesturesDrawer.style.display = "none";
  btnToggleGestures.classList.remove("active");
});

btnOpenSettings?.addEventListener("click", () => {
  window.miku.send(Ipc.OPEN_SETTINGS);
});

btnOpenSettingsStudio?.addEventListener("click", () => {
  window.miku.send(Ipc.OPEN_SETTINGS);
  modelDrawer.style.display = "none";
  btnToggleModelbar.classList.remove("active");
});

quickLlmSelect.addEventListener("change", () => {
  const chosen = quickLlmSelect.value;
  if (!chosen) return;
  if (chosen === "gemini-2.5-flash") {
    window.miku.send(Ipc.SETTINGS_UPDATE, { provider: "gemini", geminiModel: "gemini-2.5-flash" });
  } else {
    window.miku.send(Ipc.SETTINGS_UPDATE, { provider: "ollama", model: chosen });
  }
});

quickVoiceSelect.addEventListener("change", () => {
  const chosen = quickVoiceSelect.value;
  if (!chosen) return;
  if (quickPreviewAudio) {
    quickPreviewAudio.pause();
    quickPreviewAudio = null;
  }
  speechSynthesis.cancel();
  const prov = quickTtsProv?.value || currentAppSettings?.ttsProvider || "voxcpm";
  if (prov === "qwen3tts") {
    if (currentAppSettings) {
      currentAppSettings.qwen3ReferenceWav = chosen;
      currentAppSettings.ttsVoiceId = chosen;
      currentAppSettings.ttsProvider = "qwen3tts";
    }
    window.miku.send(Ipc.SETTINGS_UPDATE, { qwen3ReferenceWav: chosen, ttsVoiceId: chosen, ttsProvider: "qwen3tts" });
  } else if (prov === "fish") {
    if (currentAppSettings) {
      currentAppSettings.fishVoiceId = chosen;
      currentAppSettings.ttsProvider = "fish";
    }
    window.miku.send(Ipc.SETTINGS_UPDATE, { fishVoiceId: chosen, ttsProvider: "fish" });
  } else if (prov === "irodori") {
    if (currentAppSettings) {
      currentAppSettings.irodoriLoraId = chosen;
      currentAppSettings.ttsProvider = "irodori";
    }
    window.miku.send(Ipc.SETTINGS_UPDATE, { irodoriLoraId: chosen, ttsProvider: "irodori" });
  } else if (prov === "web") {
    if (currentAppSettings) currentAppSettings.ttsProvider = "web";
    window.miku.send(Ipc.SETTINGS_UPDATE, { ttsProvider: "web" });
  } else {
    if (currentAppSettings) {
      currentAppSettings.ttsVoiceId = chosen;
      currentAppSettings.ttsProvider = "voxcpm";
    }
    window.miku.send(Ipc.SETTINGS_UPDATE, { ttsVoiceId: chosen, ttsProvider: "voxcpm" });
  }
  updateModelVoiceLabels();
});

quickTtsProv?.addEventListener("change", () => {
  const prov = quickTtsProv.value as any;
  if (prov) {
    if (currentAppSettings) currentAppSettings.ttsProvider = prov;
    populateQuickVoices(prov);
    window.miku.send(Ipc.SETTINGS_UPDATE, { ttsProvider: prov });
    updateModelVoiceLabels();
  }
});

btnQuickPreview.addEventListener("click", () => {
  const chosen = quickVoiceSelect.value;
  if (!chosen) return;
  const prov = quickTtsProv?.value || currentAppSettings?.ttsProvider || "voxcpm";
  if (prov === "fish") {
    btnQuickPreview.textContent = "⏳";
    window.miku.send(Ipc.TEST_FISH_VOICE, { apiKey: currentAppSettings?.fishApiKey, voiceId: chosen });
    setTimeout(() => { btnQuickPreview.textContent = "▶"; }, 2500);
  } else if (prov === "web") {
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance("안녕하세요! 시스템 기본 음성입니다."));
  } else {
    btnQuickPreview.textContent = "⏳";
    window.miku.send(Ipc.PREVIEW_VOICE, chosen);
    setTimeout(() => { btnQuickPreview.textContent = "▶"; }, 1500);
  }
});

window.miku.on(Ipc.PLAY_PREVIEW_AUDIO, (payload: unknown) => {
  const p = payload as { b64: string; name: string };
  if (!p?.b64) return;
  if (quickPreviewAudio) {
    quickPreviewAudio.pause();
    quickPreviewAudio = null;
  }
  const bin = atob(p.b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  quickPreviewAudio = new Audio(url);
  void quickPreviewAudio.play().catch(() => {});
  quickPreviewAudio.onended = () => {
    URL.revokeObjectURL(url);
    quickPreviewAudio = null;
  };
});

window.miku.on(Ipc.VOICES_LIST, (cat: unknown) => {
  const data = cat as { voices: { id: string; displayName: string }[] };
  if (data && Array.isArray(data.voices)) {
    cachedVoiceCatalog = data.voices;
    quickVoiceSelect.innerHTML = "";
    data.voices.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = `${v.displayName} (${v.id})`;
      if (currentAppSettings && v.id === currentAppSettings.ttsVoiceId) opt.selected = true;
      quickVoiceSelect.appendChild(opt);
    });
    populateQuickVoices(currentAppSettings?.ttsProvider || "voxcpm");
    updateModelVoiceLabels();
  }
});

window.miku.on(Ipc.OLLAMA_MODELS_LIST, (models: unknown) => {
  const list = models as any[];
  if (Array.isArray(list)) {
    quickLlmSelect.innerHTML = "";
    
    // Add Gemini option first
    const gemOpt = document.createElement("option");
    gemOpt.value = "gemini-2.5-flash";
    gemOpt.textContent = "⚡ Google Gemini 2.5 Flash (클라우드 초고속)";
    if (currentAppSettings && currentAppSettings.provider === "gemini") {
      gemOpt.selected = true;
    }
    quickLlmSelect.appendChild(gemOpt);

    list.forEach((m) => {
      const modelName = typeof m === "string" ? m : (m?.name || "");
      if (!modelName) return;
      const opt = document.createElement("option");
      opt.value = modelName;
      const sizeStr = m?.size ? ` (${m.size})` : "";
      let tag = "";
      if (modelName.includes("styletune-v2")) tag = " [👑 Balanced RP]";
      else if (modelName.includes("heretic-styletune")) tag = " [🎭 Fast RP]";
      else if (modelName.includes("heretic")) tag = " [⚡ 초고속 RP]";
      else if (modelName.includes("fast")) tag = " [⚡ 고속]";
      else if (m?.isAbliterated) tag = " [🔓 무검열]";

      opt.textContent = `🤖 ${modelName}${sizeStr}${tag}`;
      if (currentAppSettings && currentAppSettings.provider === "ollama" && modelName === currentAppSettings.model) {
        opt.selected = true;
      }
      quickLlmSelect.appendChild(opt);
    });

    // Ensure active model from settings is never dropped even if absent from list
    if (currentAppSettings && currentAppSettings.provider === "ollama" && currentAppSettings.model) {
      const exists = Array.from(quickLlmSelect.options).some((o) => o.value === currentAppSettings!.model);
      if (!exists) {
        const curOpt = document.createElement("option");
        curOpt.value = currentAppSettings.model;
        curOpt.textContent = `🤖 ${currentAppSettings.model} (현재 선택)`;
        curOpt.selected = true;
        quickLlmSelect.appendChild(curOpt);
      }
      quickLlmSelect.value = currentAppSettings.model;
    } else if (currentAppSettings && currentAppSettings.provider === "gemini") {
      quickLlmSelect.value = "gemini-2.5-flash";
    }

    updateModelVoiceLabels();
  }
});

function updateModelVoiceLabels(): void {
  if (!currentAppSettings) return;
  const isGemini = currentAppSettings.provider === "gemini";
  const modelName = isGemini ? "Gemini Flash" : (currentAppSettings.model || "Qwen 14B");
  const shortModel = modelName.split(":")[0].replace("huihui_ai/", "").replace("-instruct", "");

  hdrActiveModel.textContent = shortModel;
  lblCurLlm.textContent = modelName;

  if (quickTtsProv) {
    quickTtsProv.value = currentAppSettings.ttsProvider || "voxcpm";
  }

  let voiceDesc = "";
  if (currentAppSettings.ttsProvider === "qwen3tts") {
    const qref = (currentAppSettings.qwen3ReferenceWav || currentAppSettings.voxcpmReferenceWav || currentAppSettings.ttsVoiceId || "").trim();
    const foundVoice = cachedVoiceCatalog.find((v) => v.id === qref);
    const vName = foundVoice ? foundVoice.displayName : (qref ? (qref.split(/[\\/]/).pop() || qref) : "기본 보이스");
    voiceDesc = `🤖 Qwen3 (${vName})`;
  } else if (currentAppSettings.ttsProvider === "fish") {
    const fid = (currentAppSettings.fishVoiceId || "").trim();
    const fav = (currentAppSettings.fishFavorites || []).find((x) => x.id === fid);
    const pre = FISH_VOICE_PRESETS.find((x) => x.id === fid);
    const vName = fav ? fav.title : pre ? pre.name : fid ? `커스텀 (${fid.slice(0, 8)}…)` : "미쿠";
    voiceDesc = `🐟 Fish Audio (${vName})`;
  } else if (currentAppSettings.ttsProvider === "irodori") {
    const lora = currentAppSettings.irodoriLoraId || "Nilou3000";
    const pre = IRODORI_LORA_PRESETS.find((x) => x.id === lora);
    voiceDesc = `🇯🇵 Irodori (${pre ? pre.name : lora})`;
  } else if (currentAppSettings.ttsProvider === "web") {
    voiceDesc = "🔊 시스템 음성";
  } else {
    const foundVoice = cachedVoiceCatalog.find((v) => v.id === currentAppSettings?.ttsVoiceId);
    voiceDesc = foundVoice ? `${foundVoice.displayName} (VoxCPM2)` : (currentAppSettings.ttsVoiceId || "로컬 음성");
  }

  if (hdrActiveVoice) hdrActiveVoice.textContent = voiceDesc;
  lblCurVoice.textContent = voiceDesc;
}

tabFree.addEventListener("click", () => {
  if (currentMode !== "free") window.miku.send(Ipc.SET_CHAT_MODE, "free");
});
tabRp.addEventListener("click", () => {
  if (currentMode !== "rp") window.miku.send(Ipc.SET_CHAT_MODE, "rp");
});
tabTutor.addEventListener("click", () => {
  if (currentMode !== "tutor") window.miku.send(Ipc.SET_CHAT_MODE, "tutor");
});

btnMute.addEventListener("click", () => {
  window.miku.send(Ipc.TOGGLE_MUTE);
});

btnHide.addEventListener("click", () => {
  window.miku.send(Ipc.TOGGLE_CHAT_WINDOW);
});

btnClear.addEventListener("click", () => {
  if (confirm("대화 기록을 비우고 새로 시작할까요?")) {
    logEl.innerHTML = "";
    currentBubble = null;
    window.miku.send(Ipc.CLEAR_HISTORY);
  }
});

window.miku.on(Ipc.CHAT_CLEARED, () => {
  logEl.innerHTML = "";
  currentBubble = null;
  appendBubble("assistant", "대화 기록이 초기화되었어! 🎵 새로운 대화를 시작해보자!");
});

const btnScreen = document.getElementById("btn-screen") as HTMLButtonElement;
const btnMouse = document.getElementById("btn-mouse") as HTMLButtonElement;

let isCountingDown = false;
btnMouse.addEventListener("click", () => {
  if (isCountingDown) return;
  const prompt = inputEl.value.trim() || (currentMode === "tutor" ? "내가 마우스로 가리킨 부분의 글/코드를 보고 자세히 설명해줘!" : "내가 마우스로 가리킨 부분을 보고 무엇인지 친절하게 설명해줘!");
  inputEl.value = "";

  isCountingDown = true;
  setStatus("⏳ 1.5초 뒤 마우스 캡처!", "loading");
  btnMouse.style.background = "#ffb432";
  btnMouse.style.color = "#071318";
  btnMouse.textContent = "⏳ 대상에 마우스 올리세요!";

  setTimeout(() => {
    isCountingDown = false;
    btnMouse.style.background = "";
    btnMouse.style.color = "";
    btnMouse.textContent = "🎯 마우스 (F9)";
    setStatus("🎯 마우스 분석 중…", "thinking");
    appendBubble("user", "🎯 [마우스 분석] " + prompt);
    window.miku.send(Ipc.CAPTURE_MOUSE_REGION, prompt);
  }, 1500);
});

const btnVocab = document.getElementById("btn-vocab") as HTMLButtonElement;
const suggestionsBar = document.getElementById("suggestions-bar") as HTMLDivElement;
const suggestionsChips = document.getElementById("suggestions-chips") as HTMLDivElement;
const btnShuffleSug = document.getElementById("btn-shuffle-sug") as HTMLButtonElement;
const btnCloseSug = document.getElementById("btn-close-sug") as HTMLButtonElement;
const btnToggleSug = document.getElementById("btn-toggle-sug") as HTMLButtonElement;

const vocabModal = document.getElementById("vocab-modal")!;
const btnCloseVocab = document.getElementById("btn-close-vocab")!;
const quizWord = document.getElementById("quiz-word")!;
const quizAnswer = document.getElementById("quiz-answer")!;
const quizReading = document.getElementById("quiz-reading")!;
const quizMeaning = document.getElementById("quiz-meaning")!;
const btnShowAns = document.getElementById("btn-show-ans")!;
const quizGrades = document.getElementById("quiz-grades")!;
const vocabList = document.getElementById("vocab-list")!;

let currentBubble: HTMLDivElement | null = null;
let currentMode: ChatMode = "free";
let srsDueCards: SrsCard[] = [];
let currentQuizIndex = 0;
let suggestionOffset = 0;

const freeSuggestions = [
  "🎯 듀오링고 일본어 퀴즈 내줘!",
  "오늘 기분 어때?",
  "좋아하는 노래 하나 추천해줘!",
  "🏪 일본 편의점 상황극 해볼까?",
  "메론빵 좋아해?",
  "🔤 일본어 단어 맞추기 게임!",
  "오늘 날씨에 어울리는 곡 알려줘!",
  "🍣 일본 식당 주문 롤플레잉 하자!",
  "미쿠가 가장 아끼는 보컬로이드 곡은?",
  "파(Leek)는 왜 들고 다니는 거야?",
];

const tutorSuggestions = [
  "🎯 4지선다 일본어 퀴즈 내줘!",
  "🏪 일본 편의점 롤플레잉 하자!",
  "🔤 빈칸 채우기 단어 퀴즈 시작!",
  "🍣 일본 식당 주문 상황극 해볼까?",
  "💡 내가 쓴 일본어 문법 검사해줘!",
  "📖 N3/N2 필수 문법과 예문 하나만!",
  "👂 일본어 문장 듣고 뜻 맞히기!",
  "자주 쓰이는 애니 일상 표현 알려줘!",
  "✨ 듀오링고 오늘의 단어 퀴즈!",
  "일본어 자연스러운 뉘앙스 차이 알려줘!",
];

const rpSuggestions = [
  "*살며시 다가가 손을 잡는다.* 미쿠, 오늘 하루 어땠어?",
  "*공원 벤치에 나란히 앉으며* 오늘 날씨 진짜 좋다, 그렇지?",
  "*파(Leek)를 건네며* 미쿠, 이거 받아줘!",
  "*무대 뒤 대기실에서 긴장한 표정으로* 미쿠, 곧 라이브 시작이야!",
  "*따뜻한 멜론빵을 나눠주며* 이거 미쿠 주려고 사 왔어.",
  "*조용히 미쿠의 노랫소리에 귀를 기울인다.*",
  "*미쿠 머리를 쓰다듬으며* 오늘도 열심히 해줘서 고마워.",
  "*장난스럽게 눈을 깜빡이며* 미쿠, 빵야!",
];

btnToggleSug.addEventListener("click", () => {
  const isHidden = suggestionsBar.style.display === "none";
  suggestionsBar.style.display = isHidden ? "flex" : "none";
  btnToggleSug.classList.toggle("active", isHidden);
});

btnCloseSug.addEventListener("click", () => {
  suggestionsBar.style.display = "none";
  btnToggleSug.classList.remove("active");
});

btnShuffleSug.addEventListener("click", () => {
  suggestionOffset++;
  updateSuggestions(currentMode);
});

function updateSuggestions(mode: ChatMode): void {
  if (!suggestionsChips) return;
  suggestionsChips.innerHTML = "";

  const sugLabel = document.querySelector(".sug-label");
  if (sugLabel) {
    sugLabel.textContent = mode === "tutor"
      ? "🦉 듀오링고 회화 놀이 & 퀴즈 추천"
      : mode === "rp"
      ? "🎭 롤플레잉 & 상황극 추천 대사"
      : "💡 추천 대화 & 듀오링고 퀴즈";
  }

  const list = mode === "tutor" ? tutorSuggestions : mode === "rp" ? rpSuggestions : freeSuggestions;
  const count = 3;
  const start = (suggestionOffset * count) % list.length;
  const selected: string[] = [];
  for (let i = 0; i < count; i++) {
    selected.push(list[(start + i) % list.length]);
  }

  selected.forEach((text) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "sug-chip-pill";
    chip.textContent = text;
    chip.title = text;
    chip.addEventListener("click", () => submitText(text));
    suggestionsChips.appendChild(chip);
  });
}
updateSuggestions("free");

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderBubbleHtml(text: string): string {
  // Strip internal reasoning / thinking tags (<think>...</think> or unclosed <think>...)
  const withoutThinking = text.replace(/<(?:think|thought)>[\s\S]*?(?:<\/(?:think|thought)>|$)/gi, "");
  // Clean markdown headings (#, ##, ###) at start of lines so bubble text doesn't show ugly hash marks
  const withoutHeadings = withoutThinking.replace(/^[#]+\s*/gm, "");
  // Clean standalone markdown horizontal dividers (---, ***, ___)
  const withoutDividers = withoutHeadings.replace(/^[ \t]*[-*_~=]{2,}[ \t]*$/gm, "");
  const clean = stripEmotionTags(withoutDividers);
  const withoutChinese = stripChineseHallucinations(clean);
  const formatted = formatChatText(withoutChinese);
  const escaped = escapeHtml(formatted);
  return escaped.replace(/\*([^*]+)\*/g, (match, p1) => {
    const trimmed = p1.trim();
    if (trimmed.length < 2) return match;
    if (/^[은는이가을를과의와도에서로으로]$/.test(trimmed)) return match;
    // Quiz questions, numbered options, quoted dialogue, or non-action prose must NEVER be dimmed into action-prose!
    if (QUIZ_OR_INSTRUCTION_REGEX.test(trimmed) || /^[“"']/.test(trimmed) || !isLikelyActionProse(trimmed)) {
      return p1;
    }
    return `<span class="action-prose">*${p1}*</span>`;
  });
}

function appendBubble(role: "user" | "assistant", text: string): HTMLDivElement {
  const b = document.createElement("div");
  b.className = "bubble " + role;
  
  const contentEl = document.createElement("div");
  contentEl.className = "bubble-text";
  contentEl.innerHTML = renderBubbleHtml(text);
  b.appendChild(contentEl);

  if (role === "assistant") {
    const metaEl = document.createElement("div");
    metaEl.className = "bubble-meta";
    b.appendChild(metaEl);
  }

  logEl.appendChild(b);
  logEl.scrollTop = logEl.scrollHeight;
  return b;
}

function submitText(text?: string): void {
  const t = (text ?? inputEl.value).trim();
  if (!t) return;
  appendBubble("user", t);
  if (!text) inputEl.value = "";
  currentBubble = null;
  errorEl.textContent = "";
  errorEl.classList.remove("show");
  setStatus("🧠 생각 중…", "thinking");
  window.miku.send(Ipc.USER_SUBMIT, t);
}

sendBtn.addEventListener("click", () => submitText());
inputEl.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    submitText();
  }
});

btnScreen.addEventListener("click", () => {
  const prompt = inputEl.value.trim() || (currentMode === "tutor" ? "내 화면에 있는 일본어/외국어 텍스트를 보고 번역과 문법 설명을 해줘!" : "지금 내 화면을 보고 무엇이 보이는지/어떤 상황인지 친절하게 설명해줘!");
  appendBubble("user", "📸 [화면 분석] " + prompt);
  inputEl.value = "";
  setStatus("📸 분석 중…", "thinking");
  window.miku.send(Ipc.CAPTURE_SCREEN, prompt);
});

// Gesture trigger buttons
const gestureEmotionMap: Record<GestureName, EmotionName> = {
  wave: "happy",
  sing: "happy",
  cheer: "happy",
  peace: "happy",
  thinking: "relaxed",
  shy: "relaxed",
  nod: "happy",
  talk: "happy",
  idle: "neutral",
  bow: "happy",
  curious: "relaxed",
  giggle: "happy",
  proud: "happy",
  explain: "relaxed",
  laugh: "happy",
  think: "relaxed",
  shoot: "happy",
  spin: "happy",
};

document.querySelectorAll(".gesture-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const gesture = (btn as HTMLElement).dataset.gesture as GestureName;
    if (gesture) {
      const emo = gestureEmotionMap[gesture] || "happy";
      window.miku.send(Ipc.PLAY_GESTURE, gesture);
      window.miku.send(Ipc.EMOTION, emo);
      setTimeout(() => {
        window.miku.send(Ipc.EMOTION, "neutral");
      }, 3200);
    }
  });
});

btnSettings.addEventListener("click", () => {
  window.miku.send(Ipc.OPEN_SETTINGS);
});

// Vocab / SRS Modal logic
btnVocab.addEventListener("click", () => {
  vocabModal.style.display = "flex";
  window.miku.send(Ipc.GET_SRS_CARDS);
});

btnCloseVocab.addEventListener("click", () => {
  vocabModal.style.display = "none";
});

btnShowAns.addEventListener("click", () => {
  quizAnswer.style.display = "block";
  btnShowAns.style.display = "none";
  quizGrades.style.display = "flex";
});

document.querySelectorAll(".btn-grade").forEach((btn) => {
  btn.addEventListener("click", () => {
    const grade = parseInt((btn as HTMLElement).dataset.grade || "3") as 1 | 2 | 3 | 4;
    const card = srsDueCards[currentQuizIndex];
    if (card) {
      window.miku.send(Ipc.REVIEW_SRS_CARD, { cardId: card.id, grade });
    }
    currentQuizIndex++;
    showNextQuiz();
  });
});

function showNextQuiz(): void {
  quizAnswer.style.display = "none";
  btnShowAns.style.display = "inline-block";
  quizGrades.style.display = "none";

  if (srsDueCards.length === 0 || currentQuizIndex >= srsDueCards.length) {
    quizWord.textContent = "🎉 오늘 복습할 단어를 모두 완료했습니다!";
    btnShowAns.style.display = "none";
    return;
  }

  const c = srsDueCards[currentQuizIndex];
  quizWord.textContent = c.word;
  quizReading.textContent = c.reading ? `[${c.reading}]` : "";
  quizMeaning.textContent = c.meaning;
}

window.miku.on(Ipc.SRS_CARDS_DATA, (payload: unknown) => {
  const data = payload as { cards: SrsCard[]; dueCards: SrsCard[]; dueCount: number };
  srsDueCards = data.dueCards || [];
  currentQuizIndex = 0;
  showNextQuiz();

  vocabList.innerHTML = "";
  if (!data.cards || data.cards.length === 0) {
    vocabList.innerHTML = '<div style="color:#8aa8b0; text-align:center; padding:10px;">저장된 단어가 없습니다. 튜터 모드에서 대화하면 자동으로 단어가 수집됩니다!</div>';
    return;
  }

  for (const c of data.cards) {
    const item = document.createElement("div");
    item.style.cssText = "background:rgba(20,35,45,0.7); border:1px solid rgba(57,197,187,0.2); border-radius:8px; padding:6px 10px; display:flex; justify-content:space-between; align-items:center;";
    const daysLeft = Math.max(0, Math.ceil((c.nextReviewAt - Date.now()) / (24 * 60 * 60 * 1000)));
    item.innerHTML = `
      <div>
        <span style="font-weight:700; color:#e8fbff;">${c.word}</span>
        ${c.reading ? `<span style="color:#39c5bb; font-size:11px; margin-left:4px;">(${c.reading})</span>` : ""}
        <div style="font-size:11px; color:#ccd; margin-top:2px;">${c.meaning}</div>
      </div>
      <div style="text-align:right; font-size:10px; color:#8aa8b0;">
        <div>반복: ${c.repetition}회</div>
        <div style="color:${daysLeft === 0 ? '#ff6b8a; font-weight:700;' : '#8aa8b0;'}">${daysLeft === 0 ? "오늘 복습!" : `${daysLeft}일 후`}</div>
      </div>
    `;
    vocabList.appendChild(item);
  }
});

// PTT
function startPtt(): void {
  pttBtn.classList.add("active");
  window.miku.send(Ipc.PTT_START);
}
function stopPtt(): void {
  pttBtn.classList.remove("active");
  window.miku.send(Ipc.PTT_STOP);
}
pttBtn.addEventListener("pointerdown", () => startPtt());
pttBtn.addEventListener("pointerup", () => stopPtt());
pttBtn.addEventListener("pointerleave", () => stopPtt());

function formatChatText(text: string): string {
  let s = text;
  s = s.replace(/([!?])([^\s])/g, "$1 $2");
  s = s.replace(/([가-힣a-zA-Z\)])(\d+[\.\)])/g, "$1\n$2");
  s = s.replace(/(\d+[\.\)])([^\s\d])/g, "$1 $2");
  s = s.replace(/(\d+\.\s*[가-힣a-zA-Z]+)(정답|골라|맞혀|도전)/g, "$1\n$2");
  s = s.replace(/([가-힣a-zA-Z\)])\.([가-힣a-zA-Z])/g, "$1. $2");
  return s;
}

window.miku.on(Ipc.LLM_DELTA, (delta: unknown) => {
  const d = String(delta ?? "");
  if (!currentBubble) {
    currentBubble = appendBubble("assistant", "");
    setStatus("💬 답변 중…", "speaking");
    errorEl.textContent = "";
    errorEl.classList.remove("show");
  }
  const textEl = (currentBubble.querySelector(".bubble-text") as HTMLElement) || currentBubble;
  (currentBubble as any).__rawText = ((currentBubble as any).__rawText || "") + d;
  textEl.innerHTML = renderBubbleHtml((currentBubble as any).__rawText);
  logEl.scrollTop = logEl.scrollHeight;
});

window.miku.on(Ipc.TTS_TIMING, (data: unknown) => {
  const t = data as { totalMs: number; synthMs: number; provider: string };
  if (!t || !currentBubble) return;
  const metaEl = currentBubble.querySelector(".bubble-meta") as HTMLElement | null;
  if (!metaEl) return;
  const provName =
    t.provider === "qwen3tts" ? "Qwen3-TTS" :
    t.provider === "fish" ? "Fish Audio" :
    t.provider === "voxcpm" ? "VoxCPM2" :
    t.provider === "irodori" ? "Irodori" :
    "Web";
  const totalSec = (t.totalMs / 1000).toFixed(2);
  const synthSec = (t.synthMs / 1000).toFixed(2);
  metaEl.innerHTML = `<span class="latency-pill" title="사용자 전송 후 첫 음성 합성 완료까지 (순수 합성: ${synthSec}초)">⚡ 음성 지연: <b>${totalSec}s</b> <span class="latency-prov">(${provName})</span></span>`;
  logEl.scrollTop = logEl.scrollHeight;
});

window.miku.on(Ipc.STATE_SYNC, (s: unknown) => {
  const state = s as {
    speaking: boolean;
    pttHeld: boolean;
    settings: AppSettings;
    lastError: string | null;
    ttsStatus: TtsStatus;
    isThinking?: boolean;
    cardsDueCount?: number;
    providerHealth?: ProviderHealthStatus;
    providerHealthMessage?: string | null;
  };

  if (btnMute && state.settings) {
    btnMute.textContent = state.settings.ttsEnabled ? "🔊" : "🔇";
    btnMute.title = state.settings.ttsEnabled ? "음소거 켜기" : "음소거 해제";
  }

  const displayErr = state.lastError || (state.providerHealth && state.providerHealth !== "HEALTHY" ? state.providerHealthMessage : null);
  if (displayErr) {
    errorEl.innerHTML = "";
    const msgSpan = document.createElement("span");
    msgSpan.className = "error-text";
    msgSpan.textContent = displayErr;
    errorEl.appendChild(msgSpan);

    if (state.providerHealth === "OFFLINE" || state.providerHealth === "RECONNECTING") {
      const btnGroup = document.createElement("div");
      btnGroup.className = "error-btn-group";

      const btnReconnect = document.createElement("button");
      btnReconnect.type = "button";
      btnReconnect.className = "retry-btn";
      btnReconnect.textContent = "🔄 다시 연결";
      btnReconnect.title = "로컬 AI (Ollama) 연결 상태 즉시 재확인";
      btnReconnect.onclick = (e) => {
        e.stopPropagation();
        btnReconnect.textContent = "🔄 확인 중…";
        window.miku.send(Ipc.RECHECK_PROVIDER);
      };
      btnGroup.appendChild(btnReconnect);

      const btnSettings = document.createElement("button");
      btnSettings.type = "button";
      btnSettings.className = "retry-btn";
      btnSettings.textContent = "⚙️ 설정";
      btnSettings.title = "연결 및 모델 설정 열기";
      btnSettings.onclick = (e) => {
        e.stopPropagation();
        window.miku.send(Ipc.OPEN_SETTINGS);
      };
      btnGroup.appendChild(btnSettings);

      errorEl.appendChild(btnGroup);
    }
    errorEl.classList.add("show");
  } else {
    errorEl.classList.remove("show");
    errorEl.innerHTML = "";
  }

  if (state.ttsStatus === "loading") {
    setStatus("🔄 로딩 중…", "loading");
  } else if (state.isThinking) {
    setStatus("🧠 생각 중…", "thinking");
  } else if (state.ttsStatus === "synthesizing") {
    setStatus("🎙️ 음성 합성", "synthesizing");
  } else if (state.speaking) {
    setStatus("🎵 말하는 중", "speaking");
  } else if (state.pttHeld) {
    setStatus("🎙️ 듣는 중", "listening");
  } else {
    setStatus("🟢 준비", "ready");
  }

  if (state.settings) {
    currentAppSettings = state.settings;
    currentMode = state.settings.chatMode;
    tabFree.classList.toggle("active", currentMode === "free");
    tabRp.classList.toggle("active", currentMode === "rp");
    tabTutor.classList.toggle("active", currentMode === "tutor");
    tutorBar.style.display = currentMode === "tutor" ? "flex" : "none";
    inputEl.placeholder = currentMode === "tutor"
      ? "일본어로 말하거나 외국어 질문하기… (Enter 전송, PTT)"
      : currentMode === "rp"
      ? "미쿠와 상황극/롤플레잉하기… (*행동 서술* 대사)"
      : "미쿠에게 말하기… (Enter 전송, Shift+Enter 줄바꿈)";
    updateSuggestions(currentMode);

    // Sync select dropdowns
    if (state.settings.provider === "gemini") {
      quickLlmSelect.value = "gemini-2.5-flash";
    } else if (state.settings.model) {
      const exists = Array.from(quickLlmSelect.options).some((o) => o.value === state.settings.model);
      if (!exists && state.settings.model) {
        const opt = document.createElement("option");
        opt.value = state.settings.model;
        opt.textContent = `🤖 ${state.settings.model}`;
        quickLlmSelect.appendChild(opt);
      }
      quickLlmSelect.value = state.settings.model;
    }
    if (quickTtsProv) {
      quickTtsProv.value = state.settings.ttsProvider || "voxcpm";
    }
    populateQuickVoices(state.settings.ttsProvider || "voxcpm");
    updateModelVoiceLabels();
  }

  const due = Number(state.cardsDueCount) || 0;
  const vocabDueEl = document.getElementById("vocab-due-count");
  if (vocabDueEl) vocabDueEl.textContent = String(due);
});

// Initial Welcome
appendBubble("assistant", "안녕! 나는 데스크톱 AI 하츠네 미쿠야 🎵 상단의 [📚 튜터] 탭을 누르면 언제든 외국어 교정 모드로 전환할 수 있어!");

window.miku.send(Ipc.GET_OLLAMA_MODELS);
window.miku.send(Ipc.READY);
