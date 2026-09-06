import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, screen, shell } from "electron";
import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ipc } from "../src/shared/ipc";
import { SrsEngine } from "./srs";
import { defaultSettings, type AppSettings, type AppState, type ChatMessage, type TtsStatus, type GestureName, type ViewMode } from "../src/shared/types";
import { completeChat, LlmError } from "./llm";
import { loadSettings, saveSettings } from "./settings";
import { VoxcpmTts, IrodoriTts, FishAudioTts, toWindowlessPython, resolveVoiceProfileConfig, isValidFishVoiceId, type TtsPlay } from "./tts";
import { applyVoiceSelection, loadVoiceCatalog, voiceById, resolveVoiceWav, addVoiceToCatalog } from "./voices";
import { CharacterCore } from "../src/core/character/CharacterCore";
import { PromptComposer } from "../src/core/prompt/PromptComposer";
import { MemoryManager } from "../src/core/memory/MemoryManager";
import { SceneStateManager } from "../src/core/memory/SceneStateManager";
import { ResponseParser } from "../src/core/response/ResponseParser";
import { ActionInterpreter } from "../src/core/response/ActionInterpreter";
import { StreamingActionSpanBuffer } from "../src/core/response/StreamingActionSpanBuffer";
import { sanitizeSpeechForTts, extractConversationalChunks } from "../src/core/response/TtsSanitizer";
export { sanitizeSpeechForTts };
import { resolveModelCapabilities } from "../src/core/model/ModelCapabilities";
import { providerHealth } from "./providerHealth";

const here = path.dirname(fileURLToPath(import.meta.url));

// 3 Dedicated Windows
let characterWin: BrowserWindow | null = null;
let chatWin: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;

let settings: AppSettings = { ...defaultSettings };
let busy = false;
let currentAbortController: AbortController | null = null;
let currentGenerationId = 0;

const characterCore = new CharacterCore();
const sceneStateManager = new SceneStateManager();
const memoryManager = new MemoryManager({ maxContextTokens: 4096 });

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
  providerHealth: "HEALTHY",
  providerHealthMessage: null,
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

function broadcastTtsPlay(play: TtsPlay, segmentId?: string): void {
  if (!characterWin || characterWin.isDestroyed()) return;
  if (play.kind === "web" && (play as any).fallback) {
    console.warn("[TTS] Web Speech fallback triggered! Reason:", (play as any).reason || "unknown");
  }
  const payload = segmentId ? { ...play, segmentId } : play;
  if (play.kind === "wav") characterWin.webContents.send(Ipc.TTS_AUDIO, payload);
  else if (play.kind === "web") characterWin.webContents.send(Ipc.TTS_WEB, payload);
  else if (play.kind === "viseme") characterWin.webContents.send(Ipc.TTS_VISEME, payload);
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
  const width = 440;
  const height = 580;
  const x = wa.x + wa.width - width - 24;
  const y = wa.y + wa.height - height - 24;
  const win = new BrowserWindow(transparentWinOpts({
    width,
    height,
    minWidth: width,
    maxWidth: width,
    minHeight: height,
    maxHeight: height,
    x,
    y,
    alwaysOnTop: true,
    resizable: false,
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
  const x = Math.max(20, wa.x + wa.width - width - 464);
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
    broadcast(Ipc.VRMA_MOTIONS_LIST, scanVrmaMotions());
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

function scanVrmaMotions(): string[] {
  const motions: string[] = [];
  const searchDirs: { dir: string; prefix: string }[] = [
    { dir: path.join(process.cwd(), "public", "models"), prefix: "/models/" },
    { dir: path.join(process.cwd(), "dist", "models"), prefix: "/models/" },
    { dir: path.join(process.cwd(), "public", "vrma"), prefix: "/vrma/" },
    { dir: path.join(process.cwd(), "dist", "vrma"), prefix: "/vrma/" },
    { dir: path.join(process.cwd(), "public", "VRMA_MotionPack", "vrma"), prefix: "/VRMA_MotionPack/vrma/" },
    { dir: path.join(process.cwd(), "dist", "VRMA_MotionPack", "vrma"), prefix: "/VRMA_MotionPack/vrma/" },
  ];

  for (const { dir, prefix } of searchDirs) {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".vrma"));
        for (const f of files) {
          const mPath = prefix + f;
          if (!motions.includes(mPath)) motions.push(mPath);
        }
      } catch {}
    }
  }

  const defaultMotion = "/models/idle_loop.vrma";
  if (!motions.includes(defaultMotion)) {
    motions.unshift(defaultMotion);
  } else {
    motions.sort((a, b) => {
      if (a === defaultMotion) return -1;
      if (b === defaultMotion) return 1;
      return a.localeCompare(b);
    });
  }
  return motions;
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
  const generationId = ++currentGenerationId;

  busy = true;
  state.isThinking = true;
  state.lastError = null;
  pushState();

  broadcast(Ipc.STOP_AUDIO);

  sceneStateManager.refreshTimePeriod();
  sceneStateManager.processTurn(clean);
  memoryManager.addMessage({ role: "user", content: clean, imageBase64 });

  // Dynamic Context Window update
  const caps = resolveModelCapabilities({
    modelName: settings.provider === "gemini" ? settings.geminiModel : settings.model,
    provider: settings.provider,
  });
  memoryManager.updateCapabilities(caps);

  const systemPrompt = PromptComposer.composeSystemPrompt({
    character: characterCore.getCharacter(),
    persona: characterCore.getPersona(),
    context: characterCore.getContext(),
    sceneState: sceneStateManager.getState(),
    memory: memoryManager.getMemory(),
    mode: settings.chatMode,
  });

  if (memoryManager.shouldSummarize(systemPrompt)) {
    memoryManager.applyFastPruning();
  }

  const promptMessages: ChatMessage[] = PromptComposer.composeChatMessages({
    character: characterCore.getCharacter(),
    persona: characterCore.getPersona(),
    context: characterCore.getContext(),
    sceneState: sceneStateManager.getState(),
    memory: memoryManager.getMemory(),
    mode: settings.chatMode,
    authorNote: (settings as any).authorNote || undefined,
    recentMessages: memoryManager.getRecentMessages(),
    provider: settings.provider,
  });

  let accumulated = "";
  let sentenceBuffer = "";
  let firstChunkHandled = false;
  const userRequestStartTime = Date.now();
  let isFirstAudioReported = false;

  const ttsPromiseQueue: Promise<void>[] = [];
  const actionSpanBuffer = new StreamingActionSpanBuffer({ mode: settings.chatMode });

  const handleActionCues = (cues: string[], speechContext?: string) => {
    if (cues.length === 0) return;
    const extendedRequest = ActionInterpreter.interpret(cues, speechContext);
    state.emotion = extendedRequest.emotion || "happy";
    state.gesture = extendedRequest.gesture || "idle";
    sceneStateManager.setEmotion(state.emotion);
    broadcast(Ipc.EMOTION, state.emotion);
    if (extendedRequest.gesture) {
      const emitTime = Date.now();
      const segmentId = "seg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
      broadcast(Ipc.GESTURE, {
        gesture: extendedRequest.gesture,
        spanCompleteTime: emitTime,
        gestureEmitTime: emitTime,
        segmentId,
        expiresAt: emitTime + 6000,
      });
    }
    pushState();
  };

  const queueSentenceForTts = (sentenceText: string, spanCompleteTime?: number) => {
    const spanTime = spanCompleteTime ?? Date.now();
    const segmentId = "seg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const expiresAt = Date.now() + Math.max(5000, sentenceText.length * 200 + 4000);
    const parsed = ResponseParser.parse(sentenceText, { mode: settings.chatMode });

    // 1. Action Cues 선제적 제스처/모션 트리거 (First-Motion Reaction)
    if (parsed.actionCues.length > 0) {
      handleActionCues(parsed.actionCues, parsed.speechText);
    } else if (!firstChunkHandled) {
      // 행동 서술이 없더라도 첫 문장 대사 키워드에서 감정/제스처 추론
      const fallbackReq = ActionInterpreter.interpret([], parsed.speechText);
      state.emotion = fallbackReq.emotion || "neutral";
      state.gesture = fallbackReq.gesture || "idle";
      sceneStateManager.setEmotion(state.emotion);
      broadcast(Ipc.EMOTION, state.emotion);
      if (fallbackReq.gesture) {
        const emitTime = Date.now();
        broadcast(Ipc.GESTURE, {
          gesture: fallbackReq.gesture,
          spanCompleteTime: spanTime,
          gestureEmitTime: emitTime,
          segmentId,
          expiresAt,
        });
      }
      pushState();
    }

    firstChunkHandled = true;

    // 2. TTS 발화 대사 정제 (*행동 서술* 및 따옴표 완전 제거)
    const cleanSpoken = sanitizeSpeechForTts(parsed.speechText.trim());
    if (!cleanSpoken) return;

    const p = (async () => {
      if (ttsPromiseQueue.length > 0) {
        await ttsPromiseQueue[ttsPromiseQueue.length - 1].catch(() => {});
      }
      if (abortSignal.aborted || generationId !== currentGenerationId) return;

      try {
        const synthStart = performance.now();
        const activeProfile = (settings.voiceProfiles || []).find((p) => p.id === settings.activeVoiceProfileId);
        const { engine, effectiveSettings, detectedLang } = resolveVoiceProfileConfig(activeProfile, cleanSpoken, settings);

        if (abortSignal.aborted || generationId !== currentGenerationId) return;

        let play: TtsPlay;
        try {
          if (engine === "fish") {
            play = await fishTts.speak(effectiveSettings, cleanSpoken);
          } else if (engine === "irodori") {
            play = await irodoriTts.speak(effectiveSettings, cleanSpoken);
          } else {
            play = await tts.speak(effectiveSettings, cleanSpoken);
          }
        } catch (engineErr) {
          // Fallback to VoxCPM if preferred engine fails
          if (engine !== "voxcpm") {
            console.warn(`[TTS] ${engine} failed for [${detectedLang}], falling back to VoxCPM:`, engineErr);
            play = await tts.speak(settings, cleanSpoken);
          } else {
            throw engineErr;
          }
        }

        if (abortSignal.aborted || generationId !== currentGenerationId) return;

        const synthDurationMs = Math.round(performance.now() - synthStart);
        broadcastTtsPlay(play, segmentId);

        if (!isFirstAudioReported) {
          isFirstAudioReported = true;
          const totalLatencyMs = Date.now() - userRequestStartTime;
          const actualProvider = (play.kind === "web" && (play as any).fallback) ? "web" : engine;
          broadcast(Ipc.TTS_TIMING, {
            totalMs: totalLatencyMs,
            synthMs: synthDurationMs,
            provider: actualProvider,
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

    let firstTokenReceived = false;
    let attempts = 0;
    const maxAttempts = 2; // At most 1 auto-retry
    let raw = "";

    while (attempts < maxAttempts) {
      try {
        providerHealth.setInferring(true);
        raw = await completeChat({
          provider: settings.provider,
          model: settings.model,
          ollamaUrl: settings.ollamaUrl,
          geminiApiKey: settings.geminiApiKey,
          geminiModel: settings.geminiModel,
          easyProxyUrl: settings.easyProxyUrl,
          messages: promptMessages,
          imageBase64,
          signal: abortSignal,
          onDelta: (chunk) => {
            if (abortSignal.aborted || generationId !== currentGenerationId) return;
            firstTokenReceived = true;
            accumulated += chunk;

            const { completedActions, speechChunk, displayDelta } = actionSpanBuffer.processDelta(chunk);

            if (displayDelta) {
              broadcast(Ipc.LLM_DELTA, displayDelta);
            }

            if (completedActions.length > 0) {
              handleActionCues(completedActions, speechChunk);
            }

            if (speechChunk) {
              sentenceBuffer += speechChunk;
              const { chunks, remaining } = extractConversationalChunks(sentenceBuffer);
              if (chunks.length > 0) {
                const chunkSpanTime = Date.now();
                sentenceBuffer = remaining;
                for (const c of chunks) {
                  queueSentenceForTts(c, chunkSpanTime);
                }
              }
            }

            if (process.env.NODE_ENV !== "production") {
              console.log("[RP-Pipeline]", {
                rawDelta: chunk,
                streamBuffer: sentenceBuffer,
                completedActions,
                speechChunk,
              });
            }
          },
        });
        providerHealth.recordInferenceSuccess();
        break; // Inference successfully finished
      } catch (err: any) {
        attempts++;
        if (abortSignal.aborted || err?.name === "AbortError") {
          return;
        }

        providerHealth.recordInferenceFailure(err);

        // Auto-retry at most 1 time ONLY IF first token has not yet been received
        if (!firstTokenReceived && attempts < maxAttempts) {
          console.warn(`[LLM Retry] First token not yet emitted. Retrying attempt ${attempts + 1}/${maxAttempts} after 600ms backoff:`, err?.message || err);
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }

        // Never auto-retry once the first token has emitted to prevent duplicate responses
        if (firstTokenReceived) {
          console.warn("[LLM Retry Guard] First token was already received; aborting retry to avoid duplicated responses.");
        }

        throw err;
      } finally {
        providerHealth.setInferring(false);
      }
    }

    const { remainingActions, remainingSpeech } = actionSpanBuffer.flush();
    if (remainingActions.length > 0) {
      handleActionCues(remainingActions, remainingSpeech);
    }
    if (remainingSpeech) {
      sentenceBuffer += remainingSpeech;
    }

    const fullParsed = ResponseParser.parse(raw, { mode: settings.chatMode });
    memoryManager.addMessage({
      role: "assistant",
      content: fullParsed.speechText || fullParsed.displayProse || raw,
      displayProse: fullParsed.displayProse || raw,
      actionCues: fullParsed.actionCues,
    });
    sceneStateManager.processTurn(clean, fullParsed.speechText, fullParsed.actionCues);
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
      sentenceBuffer = "";
    }

    await Promise.all(ttsPromiseQueue);
  } catch (err: any) {
    if (abortSignal.aborted || err?.name === "AbortError") {
      return;
    }
    const rawErrMsg = err instanceof LlmError ? err.message : String(err);
    console.error("[Main onUserMessage Error]", err);

    let friendlyMsg = "로컬 AI 연결을 다시 확인하고 있어요…";
    if (providerHealth.getStatus() === "OFFLINE") {
      friendlyMsg = "로컬 AI 연결이 원활하지 않습니다. Ollama 실행 상태를 확인해 주세요.";
    } else if (rawErrMsg.includes("AbortError") || rawErrMsg.includes("canceled")) {
      friendlyMsg = "응답이 취소되었습니다.";
    }

    state.lastError = friendlyMsg;
    broadcast(Ipc.ERROR, friendlyMsg);
    pushState();
  } finally {
    busy = false;
    state.isThinking = false;
    pushState();
  }
}

function setupIpc(): void {
  ipcMain.on(Ipc.RECHECK_PROVIDER, async () => {
    try {
      const status = await providerHealth.checkNow();
      state.providerHealth = status;
      state.providerHealthMessage = providerHealth.getMessage();
      if (status === "HEALTHY") {
        state.lastError = null;
      }
      pushState();
    } catch (err) {
      console.warn("[Main] Manual RECHECK_PROVIDER error:", err);
    }
  });

  ipcMain.on(Ipc.TOGGLE_CHAT_MODE, () => {
    if (settings.chatMode === "free") settings.chatMode = "rp";
    else if (settings.chatMode === "rp") settings.chatMode = "tutor";
    else settings.chatMode = "free";
    saveSettings(settings);
    pushState();
  });

  ipcMain.on(Ipc.SET_CHAT_MODE, (_ev, mode: string) => {
    if (mode === "free" || mode === "rp" || mode === "tutor") {
      settings.chatMode = mode;
      saveSettings(settings);
      pushState();
    }
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
      const targetW = mode === "pip" ? 200 : 440;
      const targetH = mode === "pip" ? 300 : 580;
      characterWin.setMinimumSize(targetW, targetH);
      characterWin.setMaximumSize(targetW, targetH);
      if (mode === "pip") {
        characterWin.setBounds({
          x: wa.x + wa.width - targetW - 24,
          y: wa.y + wa.height - targetH - 24,
          width: targetW,
          height: targetH,
        });
      } else {
        const b = characterWin.getBounds();
        const safeX = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - targetW - 12));
        const safeY = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - targetH - 12));
        characterWin.setBounds({
          x: safeX,
          y: safeY,
          width: targetW,
          height: targetH,
        });
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
    broadcast(Ipc.VRMA_MOTIONS_LIST, scanVrmaMotions());
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

  ipcMain.on(Ipc.SELECT_VRMA_FILE, async () => {
    const res = await dialog.showOpenDialog({
      title: "3D VRMA 모션 애니메이션 파일 선택",
      properties: ["openFile"],
      filters: [{ name: "VRM Animation (*.vrma)", extensions: ["vrma"] }],
    });

    if (!res.canceled && res.filePaths.length > 0) {
      const src = res.filePaths[0];
      const baseName = path.basename(src);

      // Copy into public/vrma and dist/vrma
      const targetDirs = [
        path.join(process.cwd(), "public", "vrma"),
        path.join(process.cwd(), "dist", "vrma"),
      ];
      for (const d of targetDirs) {
        if (!fs.existsSync(d)) {
          try { fs.mkdirSync(d, { recursive: true }); } catch {}
        }
        if (fs.existsSync(d)) {
          fs.copyFileSync(src, path.join(d, baseName));
        }
      }

      const motionUrl = "/vrma/" + baseName;
      settings.vrmaMotionPath = motionUrl;
      saveSettings(settings);

      // Tell character window to hot-reload the new idle motion!
      if (characterWin && !characterWin.isDestroyed()) {
        characterWin.webContents.send(Ipc.LOAD_VRMA_MOTION, motionUrl);
      }

      pushState();
      broadcast(Ipc.VRMA_MOTIONS_LIST, scanVrmaMotions());
    }
  });

  ipcMain.on(Ipc.LOAD_VRMA_MOTION, (_ev, motionUrl: unknown) => {
    if (typeof motionUrl === "string" && motionUrl.trim()) {
      settings.vrmaMotionPath = motionUrl;
      saveSettings(settings);
      if (characterWin && !characterWin.isDestroyed()) {
        characterWin.webContents.send(Ipc.LOAD_VRMA_MOTION, motionUrl);
      }
      pushState();
    }
  });

  ipcMain.on(Ipc.PREVIEW_VRMA_MOTION, (_ev, motionUrl: unknown) => {
    if (typeof motionUrl === "string" && motionUrl.trim()) {
      if (characterWin && !characterWin.isDestroyed()) {
        characterWin.webContents.send(Ipc.PREVIEW_VRMA_MOTION, motionUrl);
      }
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

  ipcMain.on(Ipc.PREVIEW_VOICE, (ev, voiceId: unknown) => {
    const id = typeof voiceId === "string" && voiceId.trim() ? voiceId.trim() : settings.ttsVoiceId;
    const v = voiceById(id);
    if (!v) return;
    const wavPath = resolveVoiceWav(v.wav);
    if (fs.existsSync(wavPath)) {
      try {
        const buf = fs.readFileSync(wavPath);
        ev.sender.send(Ipc.PLAY_PREVIEW_AUDIO, {
          b64: buf.toString("base64"),
          name: v.displayName || v.id,
        });
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
        const params = new URLSearchParams();
        let sortBy: "likes" | "downloads" = "likes";
        let pageNumber = 1;
        let pageSize = 30;
        let append = false;

        if (typeof query === "object" && query !== null) {
          const opt = query as {
            tag?: string;
            language?: string;
            title?: string;
            sortBy?: "likes" | "downloads";
            pageNumber?: number;
            pageSize?: number;
            append?: boolean;
          };
          if (opt.tag === "voice-actor") {
            if (opt.language === "ko") {
              params.set("title", "성우");
              params.set("language", "ko");
            } else if (opt.language === "ja") {
              params.set("title", "声優");
              params.set("language", "ja");
            } else if (opt.language === "zh") {
              params.set("title", "配音");
              params.set("language", "zh");
            } else if (opt.language === "en") {
              params.set("title", "Voice Actor");
              params.set("language", "en");
            } else {
              params.set("title", "CV");
            }
          } else if (opt.tag && opt.tag !== "all") {
            params.set("tag", opt.tag);
            if (opt.language && opt.language !== "all") params.set("language", opt.language);
          } else {
            if (opt.language && opt.language !== "all") params.set("language", opt.language);
          }
          if (opt.title) params.set("title", opt.title);
          if (opt.sortBy === "downloads") {
            params.set("sort_by", "task_count");
            sortBy = "downloads";
          }
          pageNumber = opt.pageNumber || 1;
          pageSize = opt.pageSize || 50;
          append = Boolean(opt.append);
          params.set("page_number", String(pageNumber));
          params.set("page_size", String(pageSize));
        } else {
          const q = String(query || "").trim();
          if (!q) {
            ev.sender.send(Ipc.SEARCH_FISH_MODELS, { ok: true, items: [], total: 0, append: false });
            return;
          }
          if (q.startsWith("tag:")) {
            const parts = q.slice(4).split(":");
            const tag = parts[0]?.trim();
            const lang = parts[1]?.trim();
            if (tag && tag !== "all") params.set("tag", tag);
            if (lang && lang !== "all") params.set("language", lang);
            params.set("page_size", "50");
          } else {
            params.set("title", q);
            params.set("page_size", "50");
          }
          params.set("page_number", "1");
        }

        const apiUrl = `https://api.fish.audio/model?${params.toString()}`;
        const resp = await fetch(apiUrl, {
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (!resp.ok) throw new Error("Fish Audio 검색 실패: " + resp.status);
        const data = (await resp.json()) as { items?: any[]; total?: number };
        let items = data.items || [];

        // Exact sorting on returned items to guarantee strict ordering
        if (sortBy === "downloads") {
          items.sort((a, b) => (b.task_count || 0) - (a.task_count || 0));
        } else {
          items.sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
        }

        const totalCount = data.total ?? items.length;
        const hasMore = items.length >= pageSize && (totalCount ? pageNumber * pageSize < totalCount : true);

        ev.sender.send(Ipc.SEARCH_FISH_MODELS, {
          ok: true,
          items,
          total: totalCount,
          pageNumber,
          pageSize,
          sortBy,
          append,
          hasMore,
          query,
        });
      } catch (err: any) {
        ev.sender.send(Ipc.SEARCH_FISH_MODELS, { ok: false, error: err.message, query });
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

    ipcMain.on(Ipc.DOWNLOAD_VOICE_SET, async (ev, data: { modelId: string; title?: string }) => {
      try {
        if (!data || !data.modelId) {
          ev.sender.send(Ipc.DOWNLOAD_VOICE_SET, { ok: false, error: "모델 ID가 필요합니다." });
          return;
        }

        const modelResp = await fetch(`https://api.fish.audio/model/${encodeURIComponent(data.modelId)}`, {
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (!modelResp.ok) throw new Error("모델 정보 조회 실패: " + modelResp.status);
        const modelData = (await modelResp.json()) as any;

        const title = (modelData.title || data.title || data.modelId).trim();
        const safeFolderName = title.replace(/[/\\?%*:|"<>]/g, "_").trim() || data.modelId;
        const samples = Array.isArray(modelData.samples) && modelData.samples.length > 0
          ? modelData.samples
          : [];

        const primarySample = samples[0];
        const primaryAudioUrl = primarySample?.audio;
        if (!primaryAudioUrl) {
          throw new Error("다운로드 가능한 오디오 샘플 URL이 없습니다.");
        }

        const downloadsDir = path.join(app.getPath("downloads"), "MikuChat_Voices", safeFolderName);
        fs.mkdirSync(downloadsDir, { recursive: true });

        const downloadedFiles: string[] = [];

        // Download all samples provided by the creator
        for (let i = 0; i < samples.length; i++) {
          const s = samples[i];
          if (!s?.audio) continue;
          try {
            const audioResp = await fetch(s.audio, { headers: { "User-Agent": "Mozilla/5.0" } });
            if (!audioResp.ok) continue;
            const audioBuffer = Buffer.from(await audioResp.arrayBuffer());
            const fileName = i === 0 ? `${safeFolderName}.mp3` : `${safeFolderName}_sample_${i + 1}.mp3`;
            const textFileName = i === 0 ? "transcript.txt" : `transcript_sample_${i + 1}.txt`;
            const sText = s.text || modelData.default_text || "";

            const targetFilePath = path.join(downloadsDir, fileName);
            fs.writeFileSync(targetFilePath, audioBuffer);
            fs.writeFileSync(path.join(downloadsDir, textFileName), sText, "utf8");
            downloadedFiles.push(fileName);
          } catch (sampleErr) {
            console.warn(`[Download] Sample ${i} download error:`, sampleErr);
          }
        }

        const audioFilePath = path.join(downloadsDir, `${safeFolderName}.mp3`);
        const transcriptText = primarySample?.text || modelData.default_text || "";

        const metaPath = path.join(downloadsDir, "voice_set_info.json");
        fs.writeFileSync(
          metaPath,
          JSON.stringify(
            {
              modelId: data.modelId,
              title,
              description: modelData.description || "",
              languages: modelData.languages || [],
              tags: modelData.tags || [],
              like_count: modelData.like_count || 0,
              task_count: modelData.task_count || 0,
              audioFile: `${safeFolderName}.mp3`,
              audioFiles: downloadedFiles,
              sampleCount: downloadedFiles.length,
              transcript: transcriptText,
              downloadedAt: new Date().toISOString(),
            },
            null,
            2
          ),
          "utf8"
        );

        ev.sender.send(Ipc.DOWNLOAD_VOICE_SET, {
          ok: true,
          modelId: data.modelId,
          title,
          folderPath: downloadsDir,
          audioFilePath,
        });
      } catch (err: any) {
        ev.sender.send(Ipc.DOWNLOAD_VOICE_SET, {
          ok: false,
          modelId: data?.modelId,
          error: String(err?.message || err),
        });
      }
    });

    ipcMain.on(Ipc.OPEN_DOWNLOADS_FOLDER, async (_ev, targetPath?: string) => {
      try {
        const p = targetPath || path.join(app.getPath("downloads"), "MikuChat_Voices");
        if (fs.existsSync(p)) {
          shell.openPath(p);
        } else {
          shell.openPath(app.getPath("downloads"));
        }
      } catch (e: any) {
        console.warn("다운로드 폴더 열기 실패:", e);
      }
    });

    ipcMain.on(Ipc.CREATE_CUSTOM_VOICE, async (ev, data: { name: string; filePath: string; promptText?: string }) => {
    if (!data || !data.filePath || !data.name) {
      ev.sender.send(Ipc.CREATE_CUSTOM_VOICE, { ok: false, error: "이름과 파일 경로가 필요합니다" });
      return;
    }

    try {
      const sanitized = data.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "").replace(/_{2,}/g, "_");
      const safeId = sanitized || `voice_${Date.now()}`;
      const dstDir = path.join(process.cwd(), "assets", "tts", "voices", safeId);
      const pythonExe = toWindowlessPython(settings.voxcpmPythonPath || "C:\\Users\\a4jud\\VoxCPM\\.venv\\Scripts\\python.exe");
      const scriptPath = path.join(process.cwd(), "scripts", "add_voice.py");
      const promptText = (data.promptText || "안녕하세요! 만나서 반가워요.").trim();

      const proc = spawn(pythonExe, [
        scriptPath,
        data.filePath,
        dstDir,
        safeId,
        data.name.trim(),
        promptText,
      ], {
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
      });

      let stdout = "";
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (d) => { stdout += d; });
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
    const patch = next as Partial<AppSettings>;

    // 1. If activeVoiceProfileId changed, synchronize main settings from that profile
    if (patch.activeVoiceProfileId) {
      const p = (settings.voiceProfiles || []).find((x) => x.id === patch.activeVoiceProfileId);
      if (p) {
        const eng = p.preferredEngine?.default || p.preferredEngine?.ko || settings.ttsProvider;
        settings.ttsProvider = eng;
        if (eng === "voxcpm") {
          const wavId = p.voxcpm?.koReferenceWav || settings.ttsVoiceId;
          settings.ttsVoiceId = wavId;
          const applied = applyVoiceSelection(wavId);
          if (applied) settings = { ...settings, ...applied };
        } else if (eng === "fish") {
          const fid = p.fish?.koReferenceId || p.fish?.referenceId || settings.fishVoiceId;
          if (fid && isValidFishVoiceId(fid)) {
            settings.fishVoiceId = fid;
          }
        } else if (eng === "irodori") {
          if (p.irodori?.loraId) {
            settings.irodoriLoraId = p.irodori.loraId;
          }
        }
      }
    }

    // 2. Keep active profile in sync with direct engine / voice quick selection
    const activeProfile = (settings.voiceProfiles || []).find((p) => p.id === settings.activeVoiceProfileId);
    if (activeProfile) {
      if (patch.ttsProvider) {
        if (!activeProfile.preferredEngine) activeProfile.preferredEngine = {};
        activeProfile.preferredEngine.default = patch.ttsProvider;
        activeProfile.preferredEngine.ko = patch.ttsProvider;
      }
      if (patch.fishVoiceId) {
        if (!activeProfile.fish) activeProfile.fish = {};
        activeProfile.fish.referenceId = patch.fishVoiceId;
        activeProfile.fish.koReferenceId = patch.fishVoiceId;
        if (!patch.ttsProvider) {
          settings.ttsProvider = "fish";
          if (!activeProfile.preferredEngine) activeProfile.preferredEngine = {};
          activeProfile.preferredEngine.default = "fish";
          activeProfile.preferredEngine.ko = "fish";
        }
      }
      if (patch.ttsVoiceId) {
        if (!activeProfile.voxcpm) activeProfile.voxcpm = {};
        activeProfile.voxcpm.koReferenceWav = patch.ttsVoiceId;
        activeProfile.voxcpm.defaultReferenceWav = resolveVoiceWav(patch.ttsVoiceId);
        if (!patch.ttsProvider) {
          settings.ttsProvider = "voxcpm";
          if (!activeProfile.preferredEngine) activeProfile.preferredEngine = {};
          activeProfile.preferredEngine.default = "voxcpm";
          activeProfile.preferredEngine.ko = "voxcpm";
        }
      }
      if (patch.irodoriLoraId) {
        if (!activeProfile.irodori) activeProfile.irodori = {};
        activeProfile.irodori.loraId = patch.irodoriLoraId;
        if (!patch.ttsProvider) {
          settings.ttsProvider = "irodori";
          if (!activeProfile.preferredEngine) activeProfile.preferredEngine = {};
          activeProfile.preferredEngine.default = "irodori";
          activeProfile.preferredEngine.ja = "irodori";
        }
      }
    }

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

    if (settings.userName || settings.callName || settings.relationship) {
      characterCore.updatePersona({
        userName: settings.userName || "마스터",
        callName: settings.callName || "마스터",
        relationship: settings.relationship || "서로 신뢰하고 편안하게 마음을 터놓는 가까운 파트너",
      });
    }

    saveSettings(settings);
    if (settings.pttKey !== prevKey) registerShortcuts(settings.pttKey);
    pushState();
  });

  ipcMain.on(Ipc.CLEAR_HISTORY, () => {
    currentGenerationId++;
    if (currentAbortController) {
      try { currentAbortController.abort(); } catch {}
      currentAbortController = null;
    }
    busy = false;
    memoryManager.clear();
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
      const b = characterWin.getBounds();
      const targetW = settings.viewMode === "pip" ? 200 : 440;
      const targetH = settings.viewMode === "pip" ? 300 : 580;
      characterWin.setBounds({
        x: Math.round(b.x + dx),
        y: Math.round(b.y + dy),
        width: targetW,
        height: targetH,
      });
    } catch (err) {
      console.warn("WINDOW_DRAG setBounds failed:", err);
    }
  });

  ipcMain.on(Ipc.PLAY_GESTURE, (_ev, gesture: GestureName) => {
    broadcast(Ipc.GESTURE, gesture);
  });
}

function autoLaunchOllama(): void {
  try {
    fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(1000) }).catch(() => {
      const ollamaApp = "C:\\Users\\a4jud\\AppData\\Local\\Programs\\Ollama\\ollama app.exe";
      const ollamaExe = "C:\\Users\\a4jud\\AppData\\Local\\Programs\\Ollama\\ollama.exe";
      if (fs.existsSync(ollamaApp)) {
        const proc = spawn(ollamaApp, [], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        proc.unref();
      } else if (fs.existsSync(ollamaExe)) {
        const proc = spawn(ollamaExe, ["serve"], {
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
  if (settings.userName || settings.callName || settings.relationship) {
    characterCore.updatePersona({
      userName: settings.userName || "마스터",
      callName: settings.callName || "마스터",
      relationship: settings.relationship || "서로 신뢰하고 편안하게 마음을 터놓는 가까운 파트너",
    });
  }
  const cat = loadVoiceCatalog();
  if (cat.voices.length > 0 && !cat.voices.some((v) => v.id === settings.ttsVoiceId)) {
    settings.ttsVoiceId = cat.defaultId || cat.voices[0].id;
  }
  const appliedInit = applyVoiceSelection(settings.ttsVoiceId);
  if (appliedInit) settings = { ...settings, ...appliedInit };

  // Prewarm VoxCPM worker in the background at startup so first synthesis is instant
  tts.prewarm(settings);

  providerHealth.start(
    () => settings,
    (status, message) => {
      state.providerHealth = status;
      state.providerHealthMessage = message;
      pushState();
    }
  );

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
  providerHealth.stop();
  globalShortcut.unregisterAll();
  tts.stopWorker();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
