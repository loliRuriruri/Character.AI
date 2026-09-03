import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, screen, shell } from "electron";
import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ipc } from "../src/shared/ipc";
import { parseReaction } from "../src/shared/emotion";
import { MIKU_FREE_PROMPT, MIKU_TUTOR_PROMPT } from "../src/shared/persona";
import { SrsEngine } from "./srs";
import { defaultSettings, type AppSettings, type AppState, type ChatMessage, type TtsStatus, type GestureName, type ViewMode } from "../src/shared/types";
import { completeChat, LlmError } from "./llm";
import { loadSettings, saveSettings } from "./settings";
import { VoxcpmTts, IrodoriTts, FishAudioTts, type TtsPlay } from "./tts";
import { applyVoiceSelection, loadVoiceCatalog, voiceById, resolveVoiceWav, addVoiceToCatalog } from "./voices";

const here = path.dirname(fileURLToPath(import.meta.url));

// 3 Dedicated Windows
let characterWin: BrowserWindow | null = null;
let chatWin: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;

let settings: AppSettings = { ...defaultSettings };
let history: ChatMessage[] = [];
let busy = false;
let currentAbortController: AbortController | null = null;

const tts = new VoxcpmTts((status) => setTtsStatus(status));
const srs = new SrsEngine();
const irodoriTts = new IrodoriTts((status) => setTtsStatus(status));
const fishTts = new FishAudioTts((status) => setTtsStatus(status));


const state: AppState = {
  speaking: false,
  pttHeld: false,
  chatCollapsed: false,
  settings,
  emotion: "neutral",
  gesture: "idle",
  lastError: null,
  ttsStatus: "idle",
  isThinking: false,
  viewMode: "full",
  isMuted: false,
  cardsDueCount: 0,
};

function preloadPath(): string {
  const mjs = path.join(here, "preload.mjs");
  const js = path.join(here, "preload.js");
  return fs.existsSync(mjs) ? mjs : js;
}

function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of [characterWin, chatWin, settingsWin]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  }
}

function pushState(): void {
  state.settings = settings;
  state.viewMode = settings.viewMode;
  state.isMuted = !settings.ttsEnabled;
  state.cardsDueCount = srs.getDueCount();
  broadcast(Ipc.STATE_SYNC, state);
}

function setTtsStatus(status: TtsStatus): void {
  state.ttsStatus = status;
  if (status === "speaking" || status === "synthesizing" || status === "loading") {
    state.speaking = true;
  }
  if (status === "idle") state.speaking = false;
  broadcast(Ipc.TTS_STATUS, status);
  pushState();
}

function broadcastTtsPlay(play: TtsPlay): void {
  if (!characterWin || characterWin.isDestroyed()) return;
  if (play.kind === "wav") characterWin.webContents.send(Ipc.TTS_AUDIO, play);
  else if (play.kind === "web") characterWin.webContents.send(Ipc.TTS_WEB, play);
  else if (play.kind === "viseme") characterWin.webContents.send(Ipc.TTS_VISEME, play);
}

function transparentWinOpts(extra: Electron.BrowserWindowConstructorOptions): Electron.BrowserWindowConstructorOptions {
  return {
    transparent: true,
    frame: false,
    hasShadow: false,
    autoHideMenuBar: true,
    backgroundColor: "#00000000",
    roundedCorners: false,
    ...extra,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  };
}

function createCharacterWindow(): BrowserWindow {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = 340;
  const height = 540;
  const x = wa.x + wa.width - width - 24;
  const y = wa.y + wa.height - height - 24;
  const win = new BrowserWindow(transparentWinOpts({
    width,
    height,
    x,
    y,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
  }));
  win.setBackgroundColor("#00000000");
  win.setAlwaysOnTop(true, "screen-saver");
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    try {
      fs.appendFileSync(path.join(process.cwd(), "character.log"), `[${level}] ${message} (${sourceId}:${line})
`, "utf-8");
    } catch {}
  });
  loadRenderer(win, "index.html");
  return win;
}

function createChatWindow(): BrowserWindow {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = 480;
  const height = 580;
  const x = Math.max(20, wa.x + wa.width - width - 360);
  const y = wa.y + wa.height - height - 24;
  const win = new BrowserWindow(transparentWinOpts({
    width,
    height,
    x,
    y,
    alwaysOnTop: true,
    resizable: true,
  }));
  win.setBackgroundColor("#00000000");
  win.setAlwaysOnTop(true, "screen-saver");
  loadRenderer(win, "overlay.html");

  win.webContents.once("did-finish-load", () => {
    pushState();
    win.webContents.send(Ipc.VOICES_LIST, loadVoiceCatalog());
    void fetchOllamaModels().then((ms) => {
      if (!win.isDestroyed()) win.webContents.send(Ipc.OLLAMA_MODELS_LIST, ms);
    });
  });

  return win;
}

function openSettingsWindow(): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }

  const wa = screen.getPrimaryDisplay().workArea;
  const width = 480;
  const height = 640;
  const x = Math.max(20, Math.round(wa.x + (wa.width - width) / 2));
  const y = Math.max(20, Math.round(wa.y + (wa.height - height) / 2));

  settingsWin = new BrowserWindow(transparentWinOpts({
    width,
    height,
    x,
    y,
    alwaysOnTop: true,
    resizable: true,
  }));

  settingsWin.setBackgroundColor("#00000000");
  settingsWin.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  settingsWin.setAlwaysOnTop(true, "screen-saver");
  loadRenderer(settingsWin, "settings.html");

  settingsWin.on("closed", () => {
    settingsWin = null;
  });

  settingsWin.webContents.once("did-finish-load", () => {
    pushState();
    broadcast(Ipc.VOICES_LIST, loadVoiceCatalog());
    broadcast(Ipc.VRM_MODELS_LIST, scanVrmModels());
    void fetchOllamaModels().then((ms) => broadcast(Ipc.OLLAMA_MODELS_LIST, ms));
  });
}

function loadRenderer(win: BrowserWindow, file: string): void {
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) {
    const url = file === "index.html" ? dev : new URL(file, dev).toString();
    void win.loadURL(url);
  } else {
    void win.loadFile(path.join(here, "../dist", file));
  }
}


async function fetchOllamaModels(): Promise<{ name: string; size: string; isAbliterated: boolean }[]> {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags");
    if (!res.ok) throw new Error();
    const data = (await res.json()) as any;
    if (!data.models || !Array.isArray(data.models)) return [];
    return data.models.map((m: any) => ({
      name: m.name,
      size: (m.size / (1024 * 1024 * 1024)).toFixed(1) + " GB",
      isAbliterated: m.name.includes("abliterated") || m.name.includes("uncensored") || m.name.includes("qwen3-vl"),
    }));
  } catch {
    return [
      { name: "gemma4:12b", size: "7.6 GB", isAbliterated: false },
      { name: "huihui_ai/qwen3-vl-abliterated:8b-instruct", size: "6.1 GB", isAbliterated: true },
      { name: "gemma4:31b", size: "19.0 GB", isAbliterated: false },
    ];
  }
}

function scanVrmModels(): string[] {
  const models: string[] = [];
  const dirs = [
    path.join(process.cwd(), "public", "models"),
    path.join(process.cwd(), "dist", "models"),
    path.join(here, "../public/models"),
    path.join(here, "../dist/models"),
  ];

  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".vrm"));
        for (const f of files) {
          const mPath = "/models/" + f;
          if (!models.includes(mPath)) models.push(mPath);
        }
      } catch {}
    }
  }
  return models.length > 0 ? models : ["/models/HatsuneMikuNT.vrm"];
}


async function captureMouseRegion(): Promise<string> {
  const primary = screen.getPrimaryDisplay();
  const scale = primary.scaleFactor || 1;
  const cursorPos = screen.getCursorScreenPoint();

  // Capture screen at full native resolution so cropped area is razor sharp
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: Math.round(primary.bounds.width * scale),
      height: Math.round(primary.bounds.height * scale),
    },
  });

  if (sources.length === 0) throw new Error("화면 캡처 소스를 찾을 수 없습니다.");
  const fullImg = sources[0].thumbnail;

  const cropSize = 650;
  const sw = primary.bounds.width;
  const sh = primary.bounds.height;
  const cx = Math.max(0, Math.min(sw - cropSize, Math.round(cursorPos.x - cropSize / 2)));
  const cy = Math.max(0, Math.min(sh - cropSize, Math.round(cursorPos.y - cropSize / 2)));

  const cropped = fullImg.crop({
    x: Math.round(cx * scale),
    y: Math.round(cy * scale),
    width: Math.round(cropSize * scale),
    height: Math.round(cropSize * scale),
  });

  return cropped.toJPEG(85).toString("base64");
}

async function captureCurrentScreen(): Promise<string> {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1280, height: 720 },
  });
  if (sources.length === 0) throw new Error("화면 캡처 소스를 찾을 수 없습니다.");
  return sources[0].thumbnail.toJPEG(80).toString("base64");
}


function registerShortcuts(pttKey: string): void {
  globalShortcut.unregisterAll();

  // F9 for instant mouse pointing capture
  try {
    globalShortcut.register("F9", () => {
      onMouseRegionCapture();
    });
  } catch (err) {
    console.warn("F9 shortcut registration failed:", err);
  }

  const trimmed = (pttKey || "").trim();
  if (!trimmed || trimmed.toLowerCase() === "space") return;
  try {
    globalShortcut.register(trimmed, () => {
      onPttStart();
      setTimeout(() => onPttStop(), 400);
    });
  } catch (err) {
    console.warn("Global shortcut register failed for PTT", trimmed, err);
  }
}

async function onMouseRegionCapture(customPrompt?: string): Promise<void> {
  try {
    broadcast(Ipc.GESTURE, "thinking");
    const b64 = await captureMouseRegion();
    const queryText = (customPrompt && customPrompt.trim()) ? customPrompt.trim() : "이곳에 무엇이 있는지/어떤 내용인지 설명해줘";
    const prompt = `[마우스 포인트 분석 요청] ${queryText}\n첨부된 이미지는 내가 마우스로 가리킨 위치를 정중앙에 두고 확대한 화면이야. 이미지 정중앙에 있는 텍스트, 코드, 버튼, 그림을 직접 읽어서 구체적으로 무엇인지 미쿠 말투로 자세히 설명해줘!`;
    void handleUserText(prompt, b64);
  } catch (err: any) {
    console.warn("Mouse region capture failed:", err);
    broadcast(Ipc.ERROR, "마우스 영역 캡처 실패: " + err.message);
  }
}

function onPttStart(): void {
  if (state.pttHeld) return;
  state.pttHeld = true;
  broadcast(Ipc.PTT_START);
  pushState();
}

function onPttStop(): void {
  if (!state.pttHeld) return;
  state.pttHeld = false;
  broadcast(Ipc.PTT_STOP);
  pushState();
}


export function formatChatText(text: string): string {
  let s = text;
  // Exclamation & question marks followed by any non-whitespace
  s = s.replace(/([!?])([^\s])/g, "$1 $2");
  // Numbered choices glued to preceding text: e.g. 친구2. -> 친구\n2.
  s = s.replace(/([가-힣a-zA-Z\)])(\d+[\.\)])/g, "$1\n$2");
  // Space after numbered dot: 1.친구 -> 1. 친구
  s = s.replace(/(\d+[\.\)])([^\s\d])/g, "$1 $2");
  // Separate choice ending from prompt: 4. 노래정답을 -> 4. 노래\n정답을
  s = s.replace(/(\d+\.\s*[가-힣a-zA-Z]+)(정답|골라|맞혀|도전)/g, "$1\n$2");
  // Period followed by letter
  s = s.replace(/([가-힣a-zA-Z\)])\.([가-힣a-zA-Z])/g, "$1. $2");
  return s;
}

export function sanitizeSpeechForTts(text: string): string {
  let s = formatChatText(text);
  // Soften shouting/harsh interjections that cause TTS vocal strain/pitch spikes
  s = s.replace(/와아!+/g, "와아~");
  s = s.replace(/우와!+/g, "우와~");
  s = s.replace(/앗!+/g, "앗,");
  s = s.replace(/야호!+/g, "야호~");
  s = s.replace(/대단해!+/g, "대단해~");
  // Pronounce Japanese words with Korean parenthetical readings cleanly once: ともだち(토모다치) -> 토모다치
  s = s.replace(/[\u3040-\u30ff\u4e00-\u9faf]+\s*\(([가-힣\s]+)\)/g, "$1");
  // Reverse: 친구(ともだち) -> 친구
  s = s.replace(/([가-힣]+)\s*\([\u3040-\u30ff\u4e00-\u9faf\s]+\)/g, "$1");
  // Remove quotation marks that cause awkward glottal stops in TTS
  s = s.replace(/['"`]/g, "");
  // Numbered options read cleanly with pausing commas: 1. 친구 -> 1번, 친구.
  s = s.replace(/(\d+)\.\s*([가-힣a-zA-Z]+)/g, "$1번, $2. ");
  // Soften staccato laugh sounds
  s = s.replace(/에헤헤+/g, "헤헤~");
  s = s.replace(/헤헤헤+/g, "헤헤~");
  s = s.replace(/아하하+/g, "하하~");
  s = s.replace(/히히히+/g, "히히~");
  s = s.replace(/크크크+/g, "후후~");
  s = s.replace(/[ㅋㅎ]+/g, "");
  return s.replace(/\s+/g, " ").trim();
}

function extractConversationalChunks(buf: string): { chunks: string[]; remaining: string } {
  const formatted = formatChatText(buf);
  const chunks: string[] = [];
  // Split strictly on COMPLETE natural sentences (. ! ? \n) - Never split on commas or word middles!
  const re = /([^.!?\n]+[.!?\n]+)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(formatted)) !== null) {
    const s = m[0].trim();
    if (s.length >= 2) {
      chunks.push(s);
      lastIdx = re.lastIndex;
    }
  }

  return { chunks, remaining: formatted.slice(lastIdx) };
}

async function handleUserText(text: string, imageBase64?: string): Promise<void> {
  const clean = text.trim();
  if (!clean) return;

  if (busy && currentAbortController) {
    try { currentAbortController.abort(); } catch {}
    currentAbortController = null;
  }
  if (currentAbortController) {
    try { currentAbortController.abort(); } catch {}
    currentAbortController = null;
  }
  currentAbortController = new AbortController();
  const abortSignal = currentAbortController.signal;

  busy = true;
  state.isThinking = true;
  state.lastError = null;
  pushState();

  broadcast(Ipc.STOP_AUDIO);

  const activePrompt = settings.chatMode === "tutor" ? MIKU_TUTOR_PROMPT : MIKU_FREE_PROMPT;
  if (history.length === 0 || history[0].role !== "system" || history[0].content !== activePrompt) {
    history = [{ role: "system", content: activePrompt }, ...history.filter(m => m.role !== "system")];
  }
  history.push({ role: "user", content: clean, imageBase64 });
  if (history.length > 16) {
    history = [history[0], ...history.slice(-14)];
  }

  let accumulated = "";
  let sentenceBuffer = "";
  let firstChunkHandled = false;
  const userRequestStartTime = Date.now();
  let isFirstAudioReported = false;

  const ttsPromiseQueue: Promise<void>[] = [];

  const queueSentenceForTts = (sentenceText: string) => {
    const reaction = parseReaction(sentenceText);
    if (!firstChunkHandled) {
      firstChunkHandled = true;
      state.emotion = reaction.emotion;
      state.gesture = reaction.gesture;
      broadcast(Ipc.EMOTION, reaction.emotion);
      broadcast(Ipc.GESTURE, reaction.gesture);
      pushState();
    }

    const cleanSpoken = sanitizeSpeechForTts(reaction.cleanText.trim());
    if (!cleanSpoken) return;

    const p = (async () => {
      if (ttsPromiseQueue.length > 0) {
        await ttsPromiseQueue[ttsPromiseQueue.length - 1].catch(() => {});
      }
            try {
        const synthStart = performance.now();
        const play = settings.ttsProvider === "fish"
        ? await fishTts.speak(settings, cleanSpoken)
        : settings.ttsProvider === "irodori" 
        ? await irodoriTts.speak(settings, cleanSpoken)
        : await tts.speak(settings, cleanSpoken);
        const synthDurationMs = Math.round(performance.now() - synthStart);
        broadcastTtsPlay(play);

        if (!isFirstAudioReported) {
          isFirstAudioReported = true;
          const totalLatencyMs = Date.now() - userRequestStartTime;
          broadcast(Ipc.TTS_TIMING, {
            totalMs: totalLatencyMs,
            synthMs: synthDurationMs,
            provider: settings.ttsProvider,
          });
        }
      } catch (err) {
        console.warn("Sentence TTS error:", err);
      }
    })();

    ttsPromiseQueue.push(p);
  };

  try {
    broadcast(Ipc.GESTURE, "thinking");

    const raw = await completeChat({
      provider: settings.provider,
      model: settings.model,
      ollamaUrl: settings.ollamaUrl,
      geminiApiKey: settings.geminiApiKey,
      geminiModel: settings.geminiModel,
      easyProxyUrl: settings.easyProxyUrl,
      messages: history,
      imageBase64,
      signal: abortSignal,
      onDelta: (chunk) => {
        accumulated += chunk;
        sentenceBuffer += chunk;
        broadcast(Ipc.LLM_DELTA, chunk);

        const { chunks, remaining } = extractConversationalChunks(sentenceBuffer);
        if (chunks.length > 0) {
          sentenceBuffer = remaining;
          for (const c of chunks) {
            queueSentenceForTts(c);
          }
        }
      },
    });

    history.push({ role: "assistant", content: raw });
    state.isThinking = false;
    pushState();
    // If in Tutor mode, auto-detect vocabulary lines and save to SRS
    if (settings.chatMode === "tutor") {
      const vocabMatches = [...raw.matchAll(/([a-zA-Z가-힣一-龠ぁ-ゔァ-ヴー]+)\s*(?:\(([^)]+)\))?\s*[:：\-]\s*([^\n]+)/g)];
      for (const vm of vocabMatches) {
        const word = vm[1].trim();
        const reading = (vm[2] || "").trim();
        const meaning = vm[3].trim();
        if (word && meaning && !/대답|문법|핵심|교정|단어|미쿠/i.test(word)) {
          srs.addCard(word, reading, meaning, clean);
        }
      }
    }


    // Free up busy state immediately once text generation finishes so user can interact
    busy = false;
    state.isThinking = false;
    pushState();

    if (sentenceBuffer.trim()) {
      queueSentenceForTts(sentenceBuffer.trim());
    }

    await Promise.all(ttsPromiseQueue);
  } catch (err: any) {
    if (abortSignal.aborted || err?.name === "AbortError") {
      return;
    }
    const msg = err instanceof LlmError ? err.message : String(err);
    state.lastError = msg;
    broadcast(Ipc.ERROR, msg);
    pushState();
  } finally {
    busy = false;
    state.isThinking = false;
    pushState();
  }
}

function setupIpc(): void {
  
  ipcMain.on(Ipc.TOGGLE_CHAT_MODE, () => {
    settings.chatMode = settings.chatMode === "free" ? "tutor" : "free";
    saveSettings(settings);
    pushState();
  });

  ipcMain.on(Ipc.GET_SRS_CARDS, (ev) => {
    ev.sender.send(Ipc.SRS_CARDS_DATA, {
      cards: srs.getAllCards(),
      dueCards: srs.getDueCards(),
      dueCount: srs.getDueCount(),
    });
  });

  ipcMain.on(Ipc.ADD_SRS_CARD, (_ev, data: { word: string; reading: string; meaning: string; sentence?: string }) => {
    if (data && data.word && data.meaning) {
      srs.addCard(data.word, data.reading || "", data.meaning, data.sentence || "");
      pushState();
    }
  });

  ipcMain.on(Ipc.REVIEW_SRS_CARD, (_ev, data: { cardId: string; grade: 1 | 2 | 3 | 4 }) => {
    if (data && data.cardId && data.grade) {
      srs.reviewCard(data.cardId, data.grade);
      pushState();
    }
  });

  
  ipcMain.on(Ipc.GET_OLLAMA_MODELS, async (ev) => {
    const models = await fetchOllamaModels();
    ev.sender.send(Ipc.OLLAMA_MODELS_LIST, models);
  });

  
  ipcMain.on(Ipc.SET_VIEW_MODE, (_ev, mode: ViewMode) => {
    settings.viewMode = mode;
    saveSettings(settings);
    if (characterWin && !characterWin.isDestroyed()) {
      const wa = screen.getPrimaryDisplay().workArea;
      if (mode === "pip") {
        characterWin.setSize(200, 300);
        characterWin.setPosition(wa.x + wa.width - 224, wa.y + wa.height - 324);
      } else {
        characterWin.setSize(340, 540);
      }
      characterWin.webContents.send(Ipc.SET_VIEW_MODE, mode);
    }
    pushState();
  });

  ipcMain.on(Ipc.TOGGLE_MUTE, () => {
    settings.ttsEnabled = !settings.ttsEnabled;
    saveSettings(settings);
    pushState();
  });

  ipcMain.on(Ipc.TOGGLE_CHAT_WINDOW, () => {
    if (!chatWin || chatWin.isDestroyed()) return;
    if (chatWin.isVisible()) {
      chatWin.hide();
    } else {
      chatWin.show();
      chatWin.focus();
    }
  });

  ipcMain.on(Ipc.QUIT_APP, () => {
    app.quit();
  });

  ipcMain.on(Ipc.READY, () => {
    pushState();
    broadcast(Ipc.VOICES_LIST, loadVoiceCatalog());
    broadcast(Ipc.VRM_MODELS_LIST, scanVrmModels());
  });

  ipcMain.on(Ipc.OPEN_EXTERNAL_URL, (_ev, targetUrl: unknown) => {
      if (typeof targetUrl === "string" && targetUrl.startsWith("http")) {
        void shell.openExternal(targetUrl);
      }
    });
    ipcMain.on(Ipc.OPEN_SETTINGS, () => {
    openSettingsWindow();
  });

  ipcMain.on(Ipc.CLOSE_SETTINGS, () => {
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.hide();
    }
  });

  ipcMain.on(Ipc.SELECT_VRM_FILE, async () => {
    const res = await dialog.showOpenDialog({
      title: "3D VRM 캐릭터 파일 선택",
      properties: ["openFile"],
      filters: [{ name: "VRM Model", extensions: ["vrm"] }],
    });

    if (!res.canceled && res.filePaths.length > 0) {
      const src = res.filePaths[0];
      const baseName = path.basename(src);

      // Copy into public/models and dist/models
      const targetDirs = [
        path.join(process.cwd(), "public", "models"),
        path.join(process.cwd(), "dist", "models"),
      ];
      for (const d of targetDirs) {
        if (fs.existsSync(d)) {
          fs.copyFileSync(src, path.join(d, baseName));
        }
      }

      const modelUrl = "/models/" + baseName;
      settings.vrmModelPath = modelUrl;
      saveSettings(settings);

      // Tell character window to hot-reload the new model!
      if (characterWin && !characterWin.isDestroyed()) {
        characterWin.webContents.send(Ipc.LOAD_VRM_MODEL, modelUrl);
      }

      pushState();
      broadcast(Ipc.VRM_MODELS_LIST, scanVrmModels());
    }
  });

  ipcMain.on(Ipc.LOAD_VRM_MODEL, (_ev, modelUrl: unknown) => {
    if (typeof modelUrl === "string" && modelUrl.trim()) {
      settings.vrmModelPath = modelUrl;
      saveSettings(settings);
      if (characterWin && !characterWin.isDestroyed()) {
        characterWin.webContents.send(Ipc.LOAD_VRM_MODEL, modelUrl);
      }
      pushState();
    }
  });

  
  ipcMain.on(Ipc.CAPTURE_MOUSE_REGION, async (_ev, userPrompt: unknown) => {
    void onMouseRegionCapture(typeof userPrompt === "string" ? userPrompt : undefined);
  });

  ipcMain.on(Ipc.CAPTURE_SCREEN, async (_ev, userPrompt: unknown) => {
    try {
      broadcast(Ipc.GESTURE, "thinking");
      const b64 = await captureCurrentScreen();
      const prompt = (typeof userPrompt === "string" && userPrompt.trim()) ? userPrompt.trim() : "지금 내 화면을 보고 무엇이 보이는지/어떤 상황인지 친절하게 설명해줘!";
      void handleUserText(prompt, b64);
    } catch (err: any) {
      console.warn("Screen capture failed:", err);
      broadcast(Ipc.ERROR, "화면 캡처 실패: " + err.message);
    }
  });

  ipcMain.on(Ipc.USER_SUBMIT, (_ev, text: unknown) => {
    if (typeof text === "string") void handleUserText(text);
  });

  ipcMain.on(Ipc.PTT_START, () => onPttStart());
  ipcMain.on(Ipc.PTT_STOP, () => onPttStop());

  ipcMain.on(Ipc.SET_CLICK_THROUGH, (_ev, ignore: unknown) => {
    if (!characterWin || characterWin.isDestroyed()) return;
    characterWin.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
  });

  ipcMain.on(Ipc.PREVIEW_VOICE, (_ev, voiceId: unknown) => {
    const id = typeof voiceId === "string" && voiceId.trim() ? voiceId.trim() : settings.ttsVoiceId;
    const v = voiceById(id);
    if (!v) return;
    const wavPath = resolveVoiceWav(v.wav);
    if (fs.existsSync(wavPath)) {
      try {
        const buf = fs.readFileSync(wavPath);
        if (settingsWin && !settingsWin.isDestroyed()) {
          settingsWin.webContents.send(Ipc.PLAY_PREVIEW_AUDIO, {
            b64: buf.toString("base64"),
            name: v.displayName || v.id,
          });
        }
      } catch (err) {
        console.warn("Preview audio read error:", err);
      }
    }
  });

  ipcMain.on(Ipc.SELECT_AUDIO_FILE, async (ev) => {
    const res = await dialog.showOpenDialog({
      title: "캐릭터 목소리 오디오 파일 선택 (.wav, .mp3, .ogg, .flac)",
      properties: ["openFile"],
      filters: [{ name: "Audio Files", extensions: ["wav", "mp3", "ogg", "flac", "m4a"] }],
    });
    if (!res.canceled && res.filePaths.length > 0) {
      const filePath = res.filePaths[0];
      const baseName = path.basename(filePath);
      ev.sender.send(Ipc.SELECT_AUDIO_FILE, {
        filePath,
        fileName: baseName,
      });
    }
  });

  
    
    ipcMain.on(Ipc.SEARCH_FISH_MODELS, async (ev, query: unknown) => {
      try {
        const q = String(query || "").trim();
        if (!q) {
          ev.sender.send(Ipc.SEARCH_FISH_MODELS, { ok: true, items: [] });
          return;
        }
        const resp = await fetch(`https://api.fish.audio/model?title=${encodeURIComponent(q)}&page_size=8`, {
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (!resp.ok) throw new Error("Fish Audio 검색 실패: " + resp.status);
        const data = (await resp.json()) as { items?: any[] };
        ev.sender.send(Ipc.SEARCH_FISH_MODELS, { ok: true, items: data.items || [] });
      } catch (err: any) {
        ev.sender.send(Ipc.SEARCH_FISH_MODELS, { ok: false, error: err.message });
      }
    });

    ipcMain.on(Ipc.TEST_FISH_VOICE, async (ev, data: { apiKey?: string; voiceId?: string }) => {
      try {
        const testSettings: AppSettings = {
          ...settings,
          fishApiKey: data?.apiKey || settings.fishApiKey,
          fishVoiceId: data?.voiceId || settings.fishVoiceId,
        };
        const play = await fishTts.speak(testSettings, "안녕하세요! 저는 피쉬 오디오 S2.1 프로 프리 엔진으로 말하는 미쿠예요! 만나서 정말 반가워요 [laugh]!");
        if (play.kind === "wav") {
          ev.sender.send(Ipc.PLAY_PREVIEW_AUDIO, { b64: play.b64, name: "Fish Audio Test" });
        }
      } catch (err: any) {
        broadcast(Ipc.ERROR, "Fish Audio 테스트 실패: " + err.message);
      }
    });

    ipcMain.on(Ipc.CREATE_CUSTOM_VOICE, async (ev, data: { name: string; filePath: string; promptText?: string }) => {
    if (!data || !data.filePath || !data.name) {
      ev.sender.send(Ipc.CREATE_CUSTOM_VOICE, { ok: false, error: "이름과 파일 경로가 필요합니다" });
      return;
    }

    try {
      const rawId = data.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
      const safeId = rawId || `custom_${Date.now()}`;
      const dstDir = path.join(process.cwd(), "assets", "tts", "voices", safeId);
      const pythonExe = settings.voxcpmPythonPath || "C:\\Users\\a4jud\\VoxCPM\\.venv\\Scripts\\python.exe";
      const scriptPath = path.join(process.cwd(), "scripts", "add_voice.py");
      const promptText = (data.promptText || "안녕하세요! 만나서 반가워요.").trim();

      const proc = spawn(pythonExe, [
        scriptPath,
        data.filePath,
        dstDir,
        safeId,
        data.name.trim(),
        promptText,
      ]);

      let stdout = "";
      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.on("close", (code) => {
        if (code === 0) {
          try {
            const res = JSON.parse(stdout);
            if (res.ok) {
              addVoiceToCatalog({
                id: res.id,
                displayName: res.displayName,
                wav: res.wav,
                promptText: res.promptText,
                durationSec: res.durationSec,
              });

              const applied = applyVoiceSelection(res.id);
              if (applied) {
                settings = { ...settings, ...applied };
                saveSettings(settings);
              }

              const cat = loadVoiceCatalog();
              broadcast(Ipc.VOICES_LIST, cat);
              pushState();

              ev.sender.send(Ipc.CREATE_CUSTOM_VOICE, {
                ok: true,
                voice: res,
              });
              return;
            }
          } catch {}
        }
        ev.sender.send(Ipc.CREATE_CUSTOM_VOICE, { ok: false, error: "오디오 변환 실패: " + stdout });
      });
    } catch (err: any) {
      ev.sender.send(Ipc.CREATE_CUSTOM_VOICE, { ok: false, error: String(err?.message || err) });
    }
  });

  ipcMain.on(Ipc.SETTINGS_UPDATE, (_ev, next: unknown) => {
    if (!next || typeof next !== "object") return;
    const prevKey = settings.pttKey;
    const prevVoice = settings.ttsVoiceId;
    const prevModel = settings.vrmModelPath;

    settings = { ...settings, ...(next as Partial<AppSettings>) };

    if (settings.ttsVoiceId !== prevVoice) {
      const applied = applyVoiceSelection(settings.ttsVoiceId);
      if (applied) settings = { ...settings, ...applied };
      // Worker supports instant dynamic zero-shot reference audio switching without killing process!
      setTtsStatus("idle");
      broadcast(Ipc.TTS_STATUS, "idle");
      pushState();
    }

    if (settings.vrmModelPath !== prevModel && characterWin && !characterWin.isDestroyed()) {
      characterWin.webContents.send(Ipc.LOAD_VRM_MODEL, settings.vrmModelPath);
    }

    saveSettings(settings);
    if (settings.pttKey !== prevKey) registerShortcuts(settings.pttKey);
    pushState();
  });

  ipcMain.on(Ipc.CLEAR_HISTORY, () => {
    if (currentAbortController) {
      try { currentAbortController.abort(); } catch {}
      currentAbortController = null;
    }
    busy = false;
    history = [];
    state.isThinking = false;
    state.lastError = null;
    state.ttsStatus = "idle";
    state.speaking = false;
    broadcast(Ipc.STOP_AUDIO);
    broadcast(Ipc.CHAT_CLEARED);
    pushState();
  });

  ipcMain.on(Ipc.SPEAKING, (_ev, active: unknown) => {
    state.speaking = Boolean(active);
    if (!state.speaking && state.ttsStatus !== "loading" && state.ttsStatus !== "synthesizing") {
      state.ttsStatus = "idle";
    }
    pushState();
  });

  ipcMain.on(Ipc.WINDOW_DRAG, (_ev, delta: any) => {
    if (!characterWin || characterWin.isDestroyed() || !delta) return;
    const dx = Math.round(Number(delta.dx) || 0);
    const dy = Math.round(Number(delta.dy) || 0);
    if (dx === 0 && dy === 0) return;
    try {
      const [x, y] = characterWin.getPosition();
      characterWin.setPosition(Math.round(x + dx), Math.round(y + dy));
    } catch (err) {
      console.warn("WINDOW_DRAG setPosition failed:", err);
    }
  });

  ipcMain.on(Ipc.PLAY_GESTURE, (_ev, gesture: GestureName) => {
    broadcast(Ipc.GESTURE, gesture);
  });
}

function autoLaunchOllama(): void {
  try {
    fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(1000) }).catch(() => {
      const ollamaPath = "C:\\Users\\a4jud\\AppData\\Local\\Programs\\Ollama\\ollama.exe";
      if (fs.existsSync(ollamaPath)) {
        const proc = spawn(ollamaPath, ["serve"], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        proc.unref();
      }
    });
  } catch {}
}

app.whenReady().then(() => {
  autoLaunchOllama();
  settings = loadSettings();
  const cat = loadVoiceCatalog();
  if (cat.voices.length > 0 && !cat.voices.some((v) => v.id === settings.ttsVoiceId)) {
    settings.ttsVoiceId = cat.defaultId || cat.voices[0].id;
  }
  const appliedInit = applyVoiceSelection(settings.ttsVoiceId);
  if (appliedInit) settings = { ...settings, ...appliedInit };

  // Prewarm VoxCPM worker in the background at startup so first synthesis is instant
  tts.prewarm(settings);

  setupIpc();
  characterWin = createCharacterWindow();
  chatWin = createChatWindow();
  registerShortcuts(settings.pttKey);

  characterWin.on("closed", () => {
    characterWin = null;
    if (chatWin && !chatWin.isDestroyed()) chatWin.close();
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  });

  chatWin.on("closed", () => {
    chatWin = null;
    if (characterWin && !characterWin.isDestroyed()) characterWin.close();
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  tts.stopWorker();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
