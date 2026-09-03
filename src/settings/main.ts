import { Ipc } from "../shared/ipc";
import type { AppSettings, VoiceCatalog } from "../shared/types";

const root = document.getElementById("root")!;
root.innerHTML = `
<div id="shell">
  <header>
    <span class="title">⚙️ AI 캐릭터챗 환경설정</span>
    <button id="btn-close" type="button" class="no-drag">닫기 (X)</button>
  </header>
  <div id="content" class="no-drag">
    <!-- 1. VRM Model Switcher -->
    <div class="section">
      <div class="sec-title">
        <span>🎭 3D VRM 캐릭터 변경</span>
        <button id="btn-browse-vrm" class="btn-file" type="button">📂 내 PC에서 VRM 파일 불러오기</button>
      </div>
      <label>설치된 VRM 모델 선택
        <select id="vrmModelSelect"></select>
      </label>
      <div style="font-size:10px; color:#8aa8b0; line-height:1.4;">
        * BOOTH 등에서 다운로드한 <b>.vrm</b> 파일을 선택하면 실시간으로 캐릭터가 즉시 교체됩니다!
      </div>
    </div>

    
    <!-- Mode Selection -->
    <div class="section">
      <div class="sec-title"><span>🎓 대화 모드 선택</span></div>
      <label>기본 모드
        <select id="chatModeSelect">
          <option value="free">🗣️ 일상 대화 모드 (버추얼 싱어 미쿠)</option>
          <option value="tutor">📚 일본어/외국어 튜터 모드 (실시간 문법 교정 & 단어 수집)</option>
        </select>
      </label>
    </div>

    <!-- 2. AI LLM Provider -->
    <div class="section">
      <div class="sec-title"><span>🤖 AI 대화 엔진 (LLM)</span></div>
      <label>엔진 선택
        <select id="provider">
          <option value="ollama">Ollama (로컬 GPU 가속 Gemma4)</option>
          <option value="gemini">Google Gemini Flash (0.2초 초고속)</option>
          <option value="easyproxy">EasyProxy :8317</option>
        </select>
      </label>
      <div id="gemini-fields" style="display:none; flex-direction:column; gap:6px;">
        <label>Gemini API Key (Google AI Studio)
          <input id="geminiApiKey" type="password" placeholder="AIzaSy..." />
        </label>
        <label>Gemini 모델 선택
          <select id="geminiModel">
            <option value="gemini-2.5-flash">Gemini 2.5 Flash (초고속 추천)</option>
            <option value="gemini-3.8-flash">Gemini 3.8 Flash</option>
          </select>
        </label>
      </div>
      <div id="ollama-row" style="display:flex; flex-direction:column; gap:6px;">
        <label>설치된 Ollama 모델 선택
          <select id="ollamaModelSelect"></select>
        </label>
        <label>직접 모델명 입력
          <input id="model" placeholder="gemma4:12b" />
        </label>
      </div>
    </div>

    <!-- 3. TTS Voice -->
    <div class="section">
      <div class="sec-title"><span>🎙️ 음성 합성 (TTS & 보이스)</span></div>
      <label>음성 출력 사용
        <select id="tts"><option value="on">켜기</option><option value="off">끄기</option></select>
      </label>
      <label>TTS 제공자
        <select id="ttsProvider">
          <option value="fish">🐟 Fish Audio S2.1-Pro Free (100% 무료 클라우드 / 리얼 감정·웃음)</option>
          <option value="voxcpm">VoxCPM2 (RTX 5090 애니메이션 클론 보이스)</option>
          <option value="irodori">Irodori-TTS (일본어 원어민 억양 LoRA)</option>
          <option value="web">Web Speech (시스템 기본 음성)</option>
        </select>
      </label>
      <!-- Fish Audio Cloud Settings Card -->
      <div id="fish-audio-card" style="margin-top:8px; padding:12px; background:rgba(0,210,255,0.08); border:1px solid rgba(0,210,255,0.4); border-radius:10px;">
        <div style="font-size:12.5px; font-weight:800; color:#00d2ff; margin-bottom:4px; display:flex; align-items:center; justify-content:space-between;">
          <span>🐟 Fish Audio S2.1-Pro Free 클라우드 설정</span>
          <span style="font-size:9.5px; background:rgba(100,255,150,0.2); color:#64ff96; padding:2px 8px; border-radius:99px; border:1px solid rgba(100,255,150,0.4); font-weight:700;">100% 무료 티어</span>
        </div>
        <div style="font-size:10.5px; color:#8aa8b0; line-height:1.4; margin-bottom:8px;">
          * fish.audio 에서 무료 가입 후 발급받은 API 키를 넣으면 최신 플래그십 엔진을 <b>로컬 VRAM 0% 사용</b>으로 완전 무료로 즐길 수 있습니다.
        </div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:11px;">Fish Audio API Key (필수)
            <div style="display:flex; gap:6px; margin-top:2px;">
              <input id="fishApiKey" type="password" placeholder="fish.audio의 API Keys에서 복사한 키 붙여넣기" style="flex:1;" />
              <button id="btn-open-fish-site" type="button" class="btn-file" style="background:#00d2ff; color:#06141d; font-weight:800; padding:6px 12px; border-radius:6px; font-size:11px; border:none; cursor:pointer; white-space:nowrap;">키 발급 ↗</button>
            </div>
            <div id="fish-key-hint" style="font-size:10px; color:#ffb432; margin-top:3px; line-height:1.3;">
              ⚠️ API 키가 비어있습니다! 오른쪽 [키 발급 ↗] 버튼에서 무료 키를 복사해 붙여넣어주세요 (비어있으면 기본 기계음으로 대체됨).
            </div>
          </label>
          <label style="font-size:11px;">캐릭터 보이스 모델 ID (Reference ID)
            <input id="fishVoiceId" placeholder="acc8237220d8470985ec9be6c4c480a9" style="width:100%; margin-top:2px;" />
          </label>
          <div style="font-size:10px; color:#8aa8b0; display:flex; flex-direction:column; gap:4px; margin-top:4px;">
            <div style="display:flex; gap:4px; align-items:center; flex-wrap:wrap;">
              <span style="color:#39c5bb; font-weight:700;">🎵 보컬로이드:</span>
              <button type="button" class="btn-fish-preset" data-id="acc8237220d8470985ec9be6c4c480a9" style="background:rgba(57,197,187,0.15); border:1px solid rgba(57,197,187,0.3); border-radius:4px; color:#e8fbff; font-size:10px; padding:2px 6px; cursor:pointer;">미쿠 (글로벌)</button>
              <button type="button" class="btn-fish-preset" data-id="6717a74323274cb296ea9a0da654c977" style="background:rgba(57,197,187,0.15); border:1px solid rgba(57,197,187,0.3); border-radius:4px; color:#e8fbff; font-size:10px; padding:2px 6px; cursor:pointer;">미쿠 (일본어)</button>
            </div>
            <div style="display:flex; gap:4px; align-items:center; flex-wrap:wrap;">
              <span style="color:#ffb432; font-weight:700;">⚔️ 원신/스타레일:</span>
              <button type="button" class="btn-fish-preset" data-id="5ac6fb7171ba419190700620738209d8" style="background:rgba(255,180,50,0.15); border:1px solid rgba(255,180,50,0.3); border-radius:4px; color:#e8fbff; font-size:10px; padding:2px 6px; cursor:pointer;">⚡ 라이덴</button>
              <button type="button" class="btn-fish-preset" data-id="bd08be872bc440918674af072944ba12" style="background:rgba(0,210,255,0.15); border:1px solid rgba(0,210,255,0.3); border-radius:4px; color:#e8fbff; font-size:10px; padding:2px 6px; cursor:pointer;">💧 후리나</button>
              <button type="button" class="btn-fish-preset" data-id="4858e0be678c4449bf3a7646186edd42" style="background:rgba(100,255,150,0.15); border:1px solid rgba(100,255,150,0.3); border-radius:4px; color:#e8fbff; font-size:10px; padding:2px 6px; cursor:pointer;">🌱 나히다</button>
              <button type="button" class="btn-fish-preset" data-id="2879aac2931e450f8159d2f65cd918f4" style="background:rgba(255,107,138,0.15); border:1px solid rgba(255,107,138,0.3); border-radius:4px; color:#e8fbff; font-size:10px; padding:2px 6px; cursor:pointer;">🔥 호두</button>
              <button type="button" class="btn-fish-preset" data-id="7c0ab8e2b1714ce3a80f2622a5cc459c" style="background:rgba(255,139,167,0.15); border:1px solid rgba(255,139,167,0.3); border-radius:4px; color:#e8fbff; font-size:10px; padding:2px 6px; cursor:pointer;">🌸 반디</button>
              <button type="button" class="btn-fish-preset" data-id="4c0be7e14fa24928b4f2541ca49b57d0" style="background:rgba(180,100,255,0.15); border:1px solid rgba(180,100,255,0.3); border-radius:4px; color:#e8fbff; font-size:10px; padding:2px 6px; cursor:pointer;">🕷️ 카프카</button>
            </div>
            <div style="display:flex; gap:4px; align-items:center; flex-wrap:wrap;">
              <span style="color:#ff8ba7; font-weight:700;">📺 애니메이션/게임:</span>
              <button type="button" class="btn-fish-preset" data-id="ce8248e10ec54d509f75945ad58ccfb6" style="background:rgba(255,139,167,0.15); border:1px solid rgba(255,139,167,0.3); border-radius:4px; color:#e8fbff; font-size:10px; padding:2px 6px; cursor:pointer;">⚔️ 프리렌</button>
              <button type="button" class="btn-fish-preset" data-id="6eef1184091d4e96aceb90b4681a5400" style="background:rgba(255,139,167,0.15); border:1px solid rgba(255,139,167,0.3); border-radius:4px; color:#e8fbff; font-size:10px; padding:2px 6px; cursor:pointer;">🎸 봇치</button>
              <button type="button" class="btn-fish-preset" data-id="ffe41701970d4b339ef7906300716f99" style="background:rgba(255,180,50,0.15); border:1px solid rgba(255,180,50,0.3); border-radius:4px; color:#e8fbff; font-size:10px; padding:2px 6px; cursor:pointer;">🥜 아냐</button>
              <button type="button" class="btn-fish-preset" data-id="088d160c978f4e8ba98701af1f58f842" style="background:rgba(57,197,187,0.15); border:1px solid rgba(57,197,187,0.3); border-radius:4px; color:#e8fbff; font-size:10px; padding:2px 6px; cursor:pointer;">🌸 아로나</button>
            </div>
          </div>

          <!-- Live In-app Character Search -->
          <div style="margin-top:6px; padding-top:6px; border-top:1px solid rgba(0,210,255,0.2);">
            <div style="font-size:10.5px; font-weight:700; color:#00d2ff; margin-bottom:3px; display:flex; justify-content:space-between; align-items:center;">
              <span>🔍 Fish Audio 10만+ 전 세계 캐릭터 실시간 검색</span>
              <button id="btn-open-fish-models" type="button" style="background:transparent; border:none; color:#8aa8b0; font-size:9.5px; cursor:pointer; text-decoration:underline;">웹 라이브러리 둘러보기 ↗</button>
            </div>
            <div style="display:flex; gap:4px;">
              <input id="fish-search-input" placeholder="원하는 캐릭터 영문 검색 (예: Furina, Nahida, Bocchi, Anya, Rem...)" style="flex:1; font-size:10.5px; padding:4px 8px;" />
              <button id="btn-fish-search" type="button" class="btn-file" style="background:#00d2ff; color:#06141d; font-weight:800; padding:4px 10px; border-radius:6px; font-size:11px; border:none; cursor:pointer; white-space:nowrap;">검색</button>
            </div>
            <div id="fish-search-results" style="display:none; margin-top:6px; max-height:140px; overflow-y:auto; flex-direction:column; gap:4px; padding-right:2px;"></div>
          </div>
          <div style="display:flex; gap:6px; align-items:center; margin-top:4px;">
            <label style="font-size:11px; flex:1;">지연 시간 모드
              <select id="fishLatency" style="width:100%; margin-top:2px;">
                <option value="low">Low (최저 지연 0.3~0.5초 - 실시간 대화 추천)</option>
                <option value="balanced">Balanced (균형)</option>
                <option value="normal">Normal (최고 음질)</option>
              </select>
            </label>
            <button id="btn-test-fish" type="button" style="height:32px; margin-top:16px; background:#00d2ff; color:#06141d; font-weight:800; border:none; border-radius:6px; padding:0 12px; font-size:11px; cursor:pointer; white-space:nowrap;">
              ▶ 음성 테스트
            </button>
          </div>
        </div>
      </div>

      <label id="voxcpm-voice-row">캐릭터 목소리 선택
        <div style="display:flex; gap:6px; align-items:center; margin-top:4px;">
          <select id="ttsVoiceId" style="flex:1;"></select>
          <button id="btn-preview-voice" type="button" style="background:#39c5bb; color:#071318; font-weight:700; white-space:nowrap; padding:6px 12px; border-radius:8px; border:none; cursor:pointer;" title="선택한 목소리 샘플 즉시 재생">▶ 미리듣기</button>
        </div>
      </label>
      <div id="voice-status-box" style="margin-top:4px; padding:8px 12px; border-radius:8px; background:rgba(0,0,0,0.4); border:1px solid rgba(57,197,187,0.25); display:flex; align-items:center; justify-content:space-between; font-size:11px;">
        <span style="color:#8aa8b0;">보이스 로딩 상태:</span>
        <span id="voice-status-text" style="font-weight:700; color:#39c5bb;">🟢 준비 완료</span>
      </div>
    </div>

    <!-- 4. Character Scale & Controls -->
    <div class="section">
      <div class="sec-title"><span>📐 캐릭터 크기 및 단축키</span></div>
      <label>캐릭터 크기 (휠 스크롤로도 조절 가능)
        <div style="display:flex; align-items:center; gap:8px;">
          <input id="characterScale" type="range" min="0.5" max="2.0" step="0.05" value="1.0" style="flex:1;" />
          <span id="scaleVal" style="font-weight:700; color:#39c5bb; width:35px;">1.0x</span>
        </div>
      </label>
      <label>PTT 음성인식 단축키
        <input id="pttKey" placeholder="Space 또는 F8" />
      </label>
    </div>
  </div>

  <div class="footer no-drag">
    <button id="clear-hist" type="button" style="color:#ff6b8a; border-color:rgba(255,107,138,0.3);">대화 기록 초기화</button>
    <button id="btn-save" class="btn-primary" type="button">설정 저장 및 적용</button>
  </div>
</div>
`;

const closeBtn = document.getElementById("btn-close")!;
const browseVrmBtn = document.getElementById("btn-browse-vrm")!;
const vrmSelect = document.getElementById("vrmModelSelect") as HTMLSelectElement;
const providerSel = document.getElementById("provider") as HTMLSelectElement;
const geminiFields = document.getElementById("gemini-fields")!;
const geminiApiKeyInput = document.getElementById("geminiApiKey") as HTMLInputElement;
const geminiModelSel = document.getElementById("geminiModel") as HTMLSelectElement;
const modelInput = document.getElementById("model") as HTMLInputElement;
const ollamaModelSelect = document.getElementById("ollamaModelSelect") as HTMLSelectElement;
const ttsSel = document.getElementById("tts") as HTMLSelectElement;
const ttsProvSel = document.getElementById("ttsProvider") as HTMLSelectElement;
const chatModeSelect = document.getElementById("chatModeSelect") as HTMLSelectElement;
const voiceSel = document.getElementById("ttsVoiceId") as HTMLSelectElement;
const scaleInput = document.getElementById("characterScale") as HTMLInputElement;
const scaleVal = document.getElementById("scaleVal")!;
const pttKeyInput = document.getElementById("pttKey") as HTMLInputElement;
const clearHistBtn = document.getElementById("clear-hist")!;
const saveBtn = document.getElementById("btn-save")!;

let localSettings: AppSettings | null = null;
let installedVrmList: string[] = [];

closeBtn.addEventListener("click", () => {
  const k = fishApiKeyInput?.value.trim();
  const v = fishVoiceIdInput?.value.trim();
  if (k) {
    localStorage.setItem("fishApiKey", k);
    window.miku.send(Ipc.SETTINGS_UPDATE, { fishApiKey: k, fishVoiceId: v || undefined });
  }
  window.miku.send(Ipc.CLOSE_SETTINGS);
});

browseVrmBtn.addEventListener("click", () => {
  window.miku.send(Ipc.SELECT_VRM_FILE);
});

vrmSelect.addEventListener("change", () => {
  const chosen = vrmSelect.value;
  if (chosen) {
    window.miku.send(Ipc.LOAD_VRM_MODEL, chosen);
  }
});

providerSel.addEventListener("change", () => {
  geminiFields.style.display = providerSel.value === "gemini" ? "flex" : "none";
});

scaleInput.addEventListener("input", () => {
  const val = parseFloat(scaleInput.value);
  scaleVal.textContent = val.toFixed(2) + "x";
  window.miku.send(Ipc.SET_SCALE, val);
});

clearHistBtn.addEventListener("click", () => {
  if (confirm("대화 기억을 초기화하시겠습니까?")) {
    window.miku.send(Ipc.CLEAR_HISTORY);
  }
});


const fishCard = document.getElementById("fish-audio-card") as HTMLDivElement;
const fishApiKeyInput = document.getElementById("fishApiKey") as HTMLInputElement;
const fishVoiceIdInput = document.getElementById("fishVoiceId") as HTMLInputElement;
const fishLatencySelect = document.getElementById("fishLatency") as HTMLSelectElement;
const btnTestFish = document.getElementById("btn-test-fish") as HTMLButtonElement;
const btnOpenFishSite = document.getElementById("btn-open-fish-site") as HTMLButtonElement;


function updateKeyHint(): void {
  const k = fishApiKeyInput?.value.trim();
  const hint = document.getElementById("fish-key-hint");
  if (hint) {
    if (k) {
      hint.style.color = "#64ff96";
      hint.innerHTML = "✅ API 키가 등록되었습니다! 이제 S2.1-Pro 리얼 보이스가 출력됩니다.";
    } else {
      hint.style.color = "#ffb432";
      hint.innerHTML = "⚠️ API 키가 비어있습니다! 오른쪽 <b>[키 발급 ↗]</b>에서 무료 키를 복사해 붙여넣어주세요 (비어있으면 기본 기계음으로 대체됨).";
    }
  }
}

function updateTtsProviderUi(prov: string): void {
  if (fishCard) fishCard.style.display = prov === "fish" ? "block" : "none";
  const voxRow = document.getElementById("voxcpm-voice-row");
  if (voxRow) voxRow.style.display = prov === "fish" ? "none" : "block";
}

ttsProvSel.addEventListener("change", () => {
  const prov = ttsProvSel.value;
  updateTtsProviderUi(prov);
  window.miku.send(Ipc.SETTINGS_UPDATE, { ttsProvider: prov });
});

btnOpenFishSite?.addEventListener("click", () => {
    window.miku.send(Ipc.OPEN_EXTERNAL_URL, "https://fish.audio/app/api-keys/");
  });

  // Instant auto-save as user types or pastes key
  fishApiKeyInput?.addEventListener("input", () => {
    const k = fishApiKeyInput.value.trim();
    if (k) {
      localStorage.setItem("fishApiKey", k);
      window.miku.send(Ipc.SETTINGS_UPDATE, { fishApiKey: k, ttsProvider: "fish" });
      updateKeyHint();
    } else { updateKeyHint(); }
  });
  fishApiKeyInput?.addEventListener("change", () => {
    const k = fishApiKeyInput.value.trim();
    if (k) {
      localStorage.setItem("fishApiKey", k);
      window.miku.send(Ipc.SETTINGS_UPDATE, { fishApiKey: k, ttsProvider: "fish" });
    }
  });

  fishVoiceIdInput?.addEventListener("change", () => {
    const vid = fishVoiceIdInput.value.trim();
    if (vid) {
      localStorage.setItem("fishVoiceId", vid);
      window.miku.send(Ipc.SETTINGS_UPDATE, { fishVoiceId: vid });
    }
  });
  
  document.querySelectorAll(".btn-fish-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.id;
      if (id && fishVoiceIdInput) {
        fishVoiceIdInput.value = id;
        localStorage.setItem("fishVoiceId", id);
        window.miku.send(Ipc.SETTINGS_UPDATE, { fishVoiceId: id, ttsProvider: "fish" });
      }
    });
  });
  
  btnTestFish?.addEventListener("click", () => {
    const apiKey = (fishApiKeyInput?.value.trim() || localStorage.getItem("fishApiKey") || "").trim();
    const voiceId = (fishVoiceIdInput?.value.trim() || localStorage.getItem("fishVoiceId") || "acc8237220d8470985ec9be6c4c480a9").trim();
    if (!apiKey) {
      alert("Fish Audio API 키를 입력해주세요! (fish.audio 에서 무료 발급)");
      fishApiKeyInput?.focus();
      return;
    }
    // Immediately persist to disk and storage
    localStorage.setItem("fishApiKey", apiKey);
    localStorage.setItem("fishVoiceId", voiceId);
    window.miku.send(Ipc.SETTINGS_UPDATE, { fishApiKey: apiKey, fishVoiceId: voiceId, ttsProvider: "fish" });

    btnTestFish.disabled = true;
    btnTestFish.textContent = "⏳ 합성 중…";
    window.miku.send(Ipc.TEST_FISH_VOICE, { apiKey, voiceId });
    setTimeout(() => {
      btnTestFish.disabled = false;
      btnTestFish.textContent = "▶ 음성 테스트";
    }, 4000);
  });


const fishSearchInput = document.getElementById("fish-search-input") as HTMLInputElement;
const btnFishSearch = document.getElementById("btn-fish-search") as HTMLButtonElement;
const fishSearchResults = document.getElementById("fish-search-results") as HTMLDivElement;
const btnOpenFishModels = document.getElementById("btn-open-fish-models") as HTMLButtonElement;

btnOpenFishModels?.addEventListener("click", () => {
  window.miku.send(Ipc.OPEN_EXTERNAL_URL, "https://fish.audio/models/");
});

btnFishSearch?.addEventListener("click", () => {
  const q = fishSearchInput?.value.trim();
  if (!q) return;
  if (fishSearchResults) {
    fishSearchResults.style.display = "flex";
    fishSearchResults.innerHTML = '<span style="color:#00d2ff; font-size:10.5px;">🔍 Fish Audio 라이브러리 검색 중…</span>';
  }
  window.miku.send(Ipc.SEARCH_FISH_MODELS, q);
});

fishSearchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    btnFishSearch?.click();
  }
});

window.miku.on(Ipc.SEARCH_FISH_MODELS, (res: unknown) => {
  const r = res as { ok: boolean; items?: any[]; error?: string };
  if (!fishSearchResults) return;
  fishSearchResults.style.display = "flex";
  if (!r || !r.ok || !r.items || r.items.length === 0) {
    fishSearchResults.innerHTML = '<span style="color:#8aa8b0; font-size:10.5px;">검색 결과가 없습니다. 다른 영문 캐릭터명으로 검색해보세요.</span>';
    return;
  }

  fishSearchResults.innerHTML = "";
  r.items.forEach((item) => {
    const card = document.createElement("div");
    card.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:4px 8px; background:rgba(0,0,0,0.35); border:1px solid rgba(0,210,255,0.25); border-radius:6px; font-size:10.5px;";
    
    const info = document.createElement("div");
    info.style.cssText = "overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; margin-right:6px;";
    info.innerHTML = `<span style="font-weight:700; color:#e8fbff;">${item.title}</span> <span style="color:#8aa8b0; font-size:9.5px;">[${(item.languages || []).join(",")}] ❤️ ${item.like_count || 0}</span>`;
    
    const selBtn = document.createElement("button");
    selBtn.type = "button";
    selBtn.style.cssText = "background:#00d2ff; color:#06141d; font-weight:800; border:none; border-radius:4px; padding:2px 8px; font-size:10px; cursor:pointer; white-space:nowrap;";
    selBtn.textContent = "선택";
    selBtn.addEventListener("click", () => {
      if (fishVoiceIdInput) {
        fishVoiceIdInput.value = item._id;
        localStorage.setItem("fishVoiceId", item._id);
        window.miku.send(Ipc.SETTINGS_UPDATE, { fishVoiceId: item._id, ttsProvider: "fish" });
        selBtn.textContent = "✓ 적용됨";
        selBtn.style.background = "#64ff96";
        setTimeout(() => { selBtn.textContent = "선택"; selBtn.style.background = "#00d2ff"; }, 1500);
      }
    });

    card.appendChild(info);
    card.appendChild(selBtn);
    fishSearchResults.appendChild(card);
  });
});

saveBtn.addEventListener("click", () => {
  if (!localSettings) return;
  const next: Partial<AppSettings> = {
    provider: providerSel.value as any,
    geminiApiKey: geminiApiKeyInput.value.trim(),
    geminiModel: geminiModelSel.value,
    model: modelInput.value.trim(),
    pttKey: pttKeyInput.value.trim(),
    ttsEnabled: ttsSel.value === "on",
    ttsProvider: ttsProvSel.value as any,
    ttsVoiceId: voiceSel.value,
    characterScale: parseFloat(scaleInput.value),
    vrmModelPath: vrmSelect.value || localSettings.vrmModelPath,
    chatMode: chatModeSelect.value as any,
    fishApiKey: fishApiKeyInput ? fishApiKeyInput.value.trim() : "",
    fishVoiceId: fishVoiceIdInput ? fishVoiceIdInput.value.trim() : "",
    fishLatency: (fishLatencySelect ? fishLatencySelect.value : "low") as any,
  };
  window.miku.send(Ipc.SETTINGS_UPDATE, next);
  window.miku.send(Ipc.CLOSE_SETTINGS);
});

window.miku.on(Ipc.VRM_MODELS_LIST, (models: unknown) => {
  if (Array.isArray(models)) {
    installedVrmList = models as string[];
    populateVrmModels(installedVrmList, localSettings?.vrmModelPath || "");
  }
});

window.miku.on(Ipc.STATE_SYNC, (s: unknown) => {
  const state = s as { settings: AppSettings; ttsStatus: string; isThinking: boolean };
  const vText = document.getElementById("voice-status-text");
  if (vText) {
    if (state.ttsStatus === "loading") {
      vText.innerHTML = '<span style="color:#ffb432;">🔄 보이스 모델 로딩 중… (GPU VRAM 적재)</span>';
    } else if (state.ttsStatus === "synthesizing") {
      vText.innerHTML = '<span style="color:#39c5bb;">🎙️ 음성 합성 중…</span>';
    } else {
      vText.innerHTML = '<span style="color:#64ff96;">✅ 보이스 로드 완료 (대화 가능)</span>';
    }
  }
  localSettings = state.settings;

  providerSel.value = state.settings.provider;
  geminiFields.style.display = state.settings.provider === "gemini" ? "flex" : "none";
  geminiApiKeyInput.value = state.settings.geminiApiKey || "";
  geminiModelSel.value = state.settings.geminiModel || "gemini-2.5-flash";
  modelInput.value = state.settings.model;
  pttKeyInput.value = state.settings.pttKey;
  ttsSel.value = state.settings.ttsEnabled ? "on" : "off";
  if (ttsProvSel.value !== "fish" || state.settings.ttsProvider === "fish") {
    ttsProvSel.value = state.settings.ttsProvider;
    updateTtsProviderUi(state.settings.ttsProvider);
  }
  scaleInput.value = String(state.settings.characterScale || 1.0);
  scaleVal.textContent = (state.settings.characterScale || 1.0).toFixed(2) + "x";
  if (chatModeSelect) chatModeSelect.value = state.settings.chatMode || "free";
  if (fishApiKeyInput) fishApiKeyInput.value = state.settings.fishApiKey || "";
  if (fishVoiceIdInput) fishVoiceIdInput.value = state.settings.fishVoiceId || "acc8237220d8470985ec9be6c4c480a9";
  if (fishLatencySelect) fishLatencySelect.value = state.settings.fishLatency || "low";
  updateTtsProviderUi(state.settings.ttsProvider);
    updateKeyHint();

  populateVrmModels(installedVrmList, state.settings.vrmModelPath);
});

const btnPreviewVoice = document.getElementById("btn-preview-voice") as HTMLButtonElement;
let previewAudio: HTMLAudioElement | null = null;

btnPreviewVoice.addEventListener("click", () => {
  const chosen = voiceSel.value;
  if (chosen) {
    window.miku.send(Ipc.PREVIEW_VOICE, chosen);
  }
});

voiceSel.addEventListener("change", () => {
  const chosen = voiceSel.value;
  const vText = document.getElementById("voice-status-text");
  if (vText) {
    vText.innerHTML = `<span style="color:#64ff96;">✅ ${chosen} 보이스 0초 즉시 적용됨</span>`;
  }
  if (chosen) {
    window.miku.send(Ipc.SETTINGS_UPDATE, { ttsVoiceId: chosen });
    window.miku.send(Ipc.PREVIEW_VOICE, chosen);
  }
});

window.miku.on(Ipc.PLAY_PREVIEW_AUDIO, (payload: unknown) => {
  const p = payload as { b64: string; name: string };
  if (!p?.b64) return;
  if (previewAudio) {
    previewAudio.pause();
    previewAudio = null;
  }
  const bin = atob(p.b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  previewAudio = new Audio(url);
  void previewAudio.play().catch(() => {});
  previewAudio.onended = () => {
    URL.revokeObjectURL(url);
    previewAudio = null;
  };
});


window.miku.on(Ipc.VOICES_LIST, (cat: unknown) => {
  const catalog = (cat as VoiceCatalog) ?? { defaultId: "nilou", voices: [] };
  voiceSel.innerHTML = "";
  for (const v of catalog.voices) {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = `${v.displayName} (${v.id})`;
    if (v.id === localSettings?.ttsVoiceId) opt.selected = true;
    voiceSel.appendChild(opt);
  }
});


ollamaModelSelect.addEventListener("change", () => {
  const chosen = ollamaModelSelect.value;
  if (chosen) {
    modelInput.value = chosen;
    if (localSettings) {
      window.miku.send(Ipc.SETTINGS_UPDATE, { model: chosen });
    }
  }
});

window.miku.on(Ipc.OLLAMA_MODELS_LIST, (models: unknown) => {
  if (Array.isArray(models)) {
    ollamaModelSelect.innerHTML = "";
    for (const m of models as { name: string; size: string; isAbliterated?: boolean }[]) {
      const opt = document.createElement("option");
      opt.value = m.name;
      const tag = m.isAbliterated ? " [🔓 무검열/시각]" : "";
      opt.textContent = `${m.name} (${m.size})${tag}`;
      if (m.name === (localSettings?.model || "gemma4:12b")) {
        opt.selected = true;
      }
      ollamaModelSelect.appendChild(opt);
    }
  }
});

window.miku.send(Ipc.GET_OLLAMA_MODELS);

function populateVrmModels(models: string[], currentPath: string): void {
  vrmSelect.innerHTML = "";
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m;
    const displayName = m.replace(/^.*[\\\/]/, "");
    opt.textContent = displayName;
    if (m === currentPath || displayName === currentPath.replace(/^.*[\\\/]/, "")) {
      opt.selected = true;
    }
    vrmSelect.appendChild(opt);
  }
}


// --- Voice Studio Logic Inside Settings ---
const studioVoiceName = document.getElementById("studio-voice-name") as HTMLInputElement;
const btnChooseAudio = document.getElementById("btn-choose-audio") as HTMLButtonElement;
const selectedAudioName = document.getElementById("selected-audio-name") as HTMLSpanElement;
const studioPromptText = document.getElementById("studio-prompt-text") as HTMLInputElement;
const btnCreateVoice = document.getElementById("btn-create-voice") as HTMLButtonElement;
const studioStatus = document.getElementById("studio-status") as HTMLDivElement;

let chosenVoiceFilePath = "";

btnChooseAudio?.addEventListener("click", () => {
  window.miku.send(Ipc.SELECT_AUDIO_FILE);
});

window.miku.on(Ipc.SELECT_AUDIO_FILE, (data: unknown) => {
  const d = data as { filePath: string; fileName: string };
  if (d && d.filePath) {
    chosenVoiceFilePath = d.filePath;
    if (selectedAudioName) {
      selectedAudioName.textContent = "✅ " + d.fileName;
      selectedAudioName.style.color = "#39c5bb";
    }
    if (studioVoiceName && !studioVoiceName.value.trim()) {
      studioVoiceName.value = d.fileName.replace(/\.[^/.]+$/, "");
    }
  }
});

btnCreateVoice?.addEventListener("click", () => {
  const name = studioVoiceName?.value.trim();
  if (!name) {
    alert("캐릭터 이름을 입력해주세요!");
    studioVoiceName?.focus();
    return;
  }
  if (!chosenVoiceFilePath) {
    alert("음성 파일(.wav, .mp3)을 선택해주세요!");
    return;
  }

  if (studioStatus) {
    studioStatus.style.display = "block";
    studioStatus.style.background = "rgba(57,197,187,0.15)";
    studioStatus.style.color = "#39c5bb";
    studioStatus.innerHTML = "<span>⏳ <b>" + name + "</b> 목소리 정규화 및 등록 중…</span>";
  }
  btnCreateVoice.disabled = true;

  window.miku.send(Ipc.CREATE_CUSTOM_VOICE, {
    name,
    filePath: chosenVoiceFilePath,
    promptText: studioPromptText?.value.trim(),
  });
});

window.miku.on(Ipc.CREATE_CUSTOM_VOICE, (res: unknown) => {
  if (btnCreateVoice) btnCreateVoice.disabled = false;
  const r = res as { ok: boolean; voice?: { id: string; displayName?: string; name?: string }; error?: string };
  if (r && r.ok && r.voice) {
    const vName = r.voice.displayName || r.voice.name || r.voice.id;
    if (studioStatus) {
      studioStatus.style.display = "block";
      studioStatus.style.background = "rgba(100,255,150,0.2)";
      studioStatus.style.color = "#64ff96";
      studioStatus.innerHTML = "<span>🎉 <b>" + vName + "</b> 보이스 등록 완료! 즉시 적용되었습니다.</span>";
    }
    if (localSettings) {
      localSettings.ttsVoiceId = r.voice.id;
    }
    if (voiceSel) {
      voiceSel.value = r.voice.id;
    }
    window.miku.send(Ipc.SETTINGS_UPDATE, { ttsVoiceId: r.voice.id });
    window.miku.send(Ipc.PREVIEW_VOICE, r.voice.id);
  } else {
    if (studioStatus) {
      studioStatus.style.display = "block";
      studioStatus.style.background = "rgba(255,107,138,0.25)";
      studioStatus.style.color = "#ff6b8a";
      studioStatus.textContent = "❌ 등록 실패: " + (r?.error || "알 수 없는 오류");
    }
  }
});
