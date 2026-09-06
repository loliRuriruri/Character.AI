import { Ipc } from "../shared/ipc";
import { stripEmotionTags } from "../shared/emotion";
import type { EmotionName, GestureName, ViewMode } from "../shared/types";
import { VrmStage } from "./VrmStage";
import { motionEventBus } from "./motionEventBus";
import { audioContextPlayer } from "./audioContextPlayer";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const boot = document.getElementById("boot");
const stage = new VrmStage(canvas);
(window as any).stage = stage;

let lastHit = false;
let currentAudio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let currentScale = 1.0;

// Dragging state
let isDragging = false;
let hasDragged = false;
let dragStartX = 0;
let dragStartY = 0;
let lastScreenX = 0;
let lastScreenY = 0;

// Streaming Audio Queue
interface QueueItem {
  type: "wav" | "web";
  b64?: string;
  text: string;
  durationHint: number;
  segmentId?: string;
}
const audioQueue: QueueItem[] = [];
let isQueuePlaying = false;

function setBoot(msg: string): void {
  if (boot) boot.textContent = msg;
}

function koreanVoice(): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang.toLowerCase().startsWith("ko"));
}

function stopAudio(): void {
  audioContextPlayer.stop();
  audioQueue.length = 0;
  isQueuePlaying = false;
  stage.stopVisemes();
  stage.setSpeaking(false);
  if (currentAudio) {
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  speechSynthesis.cancel();
  stage.stopVisemes();
  window.miku.send(Ipc.SPEAKING, false);
  stage.setSpeaking(false);
  stage.setEmotion("neutral");
  motionEventBus.emit({ type: "tts:end" });
}

function playNextInQueue(): void {
  if (audioQueue.length === 0) {
    isQueuePlaying = false;
    window.miku.send(Ipc.SPEAKING, false);
    stage.setSpeaking(false);
    stage.stopVisemes();
    motionEventBus.emit({ type: "tts:end" });
    // Restore gentle neutral emotion after natural afterglow pause
    setTimeout(() => {
      if (!isQueuePlaying) {
        stage.setEmotion("neutral");
      }
    }, 1200);
    return;
  }

  isQueuePlaying = true;
  window.miku.send(Ipc.SPEAKING, true);
  stage.setSpeaking(true);
  const item = audioQueue.shift()!;
  motionEventBus.emit({ type: "tts:start", payload: { text: item.text } });

  if (item.type === "wav" && item.b64) {
    playSingleWav(item.b64, item.text, item.durationHint, item.segmentId);
  } else {
    playSingleWeb(item.text, item.segmentId);
  }
}

function playSingleWav(b64: string, text: string, durationHint: number, segmentId?: string): void {
  stage.speakVisemes(text, Math.max(0.4, durationHint));

  audioContextPlayer.play(b64)
    .then(() => {
      if (segmentId) stage.notifySegmentEnded(segmentId);
      // 280ms natural human breathing pause between complete sentences (prevents rushed machine-gun pacing)
      setTimeout(() => playNextInQueue(), 280);
    })
    .catch((err) => {
      console.error("[AudioPlayer Error]", err);
      if (segmentId) stage.notifySegmentEnded(segmentId);
      playNextInQueue();
    });
}

function playSingleWeb(text: string, segmentId?: string): void {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  const v = koreanVoice();
  if (v) u.voice = v;
  u.rate = 1.05;

  u.onstart = () => {
    stage.speakVisemes(text, Math.max(0.6, text.length * 0.08));
  };

  u.onend = () => {
    if (segmentId) stage.notifySegmentEnded(segmentId);
    setTimeout(() => playNextInQueue(), 250);
  };

  u.onerror = () => {
    if (segmentId) stage.notifySegmentEnded(segmentId);
    playNextInQueue();
  };

  speechSynthesis.speak(u);
}

// Queue handlers for incoming TTS chunks
window.miku.on(Ipc.TTS_AUDIO, (payload: unknown) => {
  const p = payload as { b64?: string; text?: string; duration?: number; segmentId?: string };
  if (typeof p?.b64 !== "string" || typeof p?.text !== "string") return;
  const clean = stripEmotionTags(p.text);
  if (!clean) return;

  audioQueue.push({
    type: "wav",
    b64: p.b64,
    text: clean,
    durationHint: Number(p.duration) || Math.max(0.5, clean.length * 0.09),
    segmentId: p.segmentId,
  });

  if (!isQueuePlaying) {
    playNextInQueue();
  }
});

window.miku.on(Ipc.TTS_WEB, (payload: unknown) => {
  const p = payload as { text?: string; segmentId?: string };
  if (typeof p?.text !== "string") return;
  const clean = stripEmotionTags(p.text);
  if (!clean) return;

  audioQueue.push({
    type: "web",
    text: clean,
    durationHint: Math.max(0.6, clean.length * 0.08),
    segmentId: p.segmentId,
  });

  if (!isQueuePlaying) {
    playNextInQueue();
  }
});

window.miku.on(Ipc.TTS_VISEME, (payload: unknown) => {
  const p = payload as { text?: string; duration?: number };
  if (typeof p?.text !== "string") return;
  stage.speakVisemes(p.text, Number(p.duration) || Math.max(0.5, p.text.length * 0.08));
});

window.miku.on(Ipc.STOP_AUDIO, () => {
  stopAudio();
});

window.miku.on(Ipc.CHAT_CLEARED, () => {
  stopAudio();
});

window.miku.on(Ipc.USER_SUBMIT, (text: unknown) => {
  motionEventBus.emit({ type: "user:submit", payload: { text: typeof text === "string" ? text : "" } });
});

window.miku.on(Ipc.LLM_DELTA, (delta: unknown) => {
  motionEventBus.emit({ type: "llm:firstToken", payload: { token: typeof delta === "string" ? delta : "" } });
});

window.miku.on(Ipc.EMOTION, (name: unknown) => {
  stage.setEmotion(name as EmotionName);
  motionEventBus.emit({ type: "llm:intent", payload: { emotion: name as any } });
});

window.miku.on(Ipc.LOAD_VRM_MODEL, async (modelUrl: unknown) => {
  if (typeof modelUrl === "string" && modelUrl.trim()) {
    try {
      setBoot("캐릭터 교체 중…");
      await stage.load(modelUrl);
      setBoot("");
      stage.play("wave");
    } catch (err) {
      setBoot("캐릭터 교체 실패: " + err);
    }
  }
});

window.miku.on(Ipc.LOAD_VRMA_MOTION, async (motionUrl: unknown) => {
  if (typeof motionUrl === "string" && motionUrl.trim()) {
    try {
      setBoot("대기 모션 교체 중…");
      await stage.loadIdleMotion(motionUrl);
      setBoot("");
      stage.play("wave");
    } catch (err) {
      setBoot("모션 교체 실패: " + err);
      setTimeout(() => setBoot(""), 3000);
    }
  }
});

window.miku.on(Ipc.PREVIEW_VRMA_MOTION, async (motionUrl: unknown) => {
  if (typeof motionUrl === "string" && motionUrl.trim()) {
    try {
      await stage.previewVrmaMotion(motionUrl);
    } catch (err) {
      console.warn("모션 미리보기 실패:", err);
    }
  }
});

window.miku.on(Ipc.GESTURE, (payload: unknown) => {
  const name = typeof payload === "string" ? payload : (payload as any)?.gesture;
  const timing = typeof payload === "object" ? (payload as any) : undefined;
  if (name) {
    stage.play(name as GestureName, timing);
    motionEventBus.emit({ type: "llm:intent", payload: { gesture: name as any } });
  }
});

window.miku.on(Ipc.PLAY_GESTURE, (payload: unknown) => {
  const name = typeof payload === "string" ? payload : (payload as any)?.gesture;
  const timing = typeof payload === "object" ? (payload as any) : undefined;
  if (name) {
    stage.play(name as GestureName, timing);
    motionEventBus.emit({ type: "llm:intent", payload: { gesture: name as any } });
  }
});

window.miku.on(Ipc.STATE_SYNC, (payload: unknown) => {
  const s = payload as { isThinking?: boolean };
  if (typeof s?.isThinking === "boolean") {
    stage.setThinking(s.isThinking);
    if (s.isThinking) {
      motionEventBus.emit({ type: "user:submit" });
    } else {
      motionEventBus.emit({ type: "llm:done" });
    }
  }
});

// ============================================================================
// Phase 1 & Section 16: Motion Diagnostics & Known-Good VRMA Test HUD (F2 Key)
// ============================================================================
const hud = document.createElement("div");
hud.id = "motion-debug-hud";
hud.style.cssText = "display:none; position:fixed; top:12px; left:12px; z-index:999999; background:rgba(8,14,24,0.92); border:1px solid rgba(57,197,187,0.5); border-radius:12px; padding:12px; color:#e0f7f6; font:12px/1.5 monospace; box-shadow:0 10px 30px rgba(0,0,0,0.7); backdrop-filter:blur(16px); min-width:260px;";
hud.innerHTML = `
  <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(57,197,187,0.3); padding-bottom:6px; margin-bottom:8px;">
    <span style="font-weight:bold; color:#39c5bb;">🔬 VRM Motion Debug HUD (F2)</span>
    <span id="hud-close" style="cursor:pointer; color:#888;">✕</span>
  </div>
  <div id="hud-status" style="margin-bottom:10px; font-size:11px; line-height:1.6;">
    <div>Loading MotionDirector status...</div>
  </div>
  <div style="display:flex; flex-wrap:wrap; gap:4px;">
    <button id="btn-vrma-only" style="flex:1 1 100%; background:rgba(255,170,0,0.2); border:1px solid #ffaa00; color:#ffdd88; padding:5px; border-radius:6px; cursor:pointer; font-weight:bold;">🔬 순수 VRMA만 재생 (Rig 진단)</button>
    <button id="btn-toggle-proc" style="flex:1 1 48%; background:rgba(57,197,187,0.2); border:1px solid #39c5bb; color:#39c5bb; padding:4px; border-radius:6px; cursor:pointer;">호흡/손가락 토글</button>
    <button id="btn-test-idle" style="flex:1 1 48%; background:rgba(255,255,255,0.1); border:1px solid #666; color:#fff; padding:4px; border-radius:6px; cursor:pointer;">대기 복귀</button>
    <button id="btn-test-wave" style="flex:1 1 30%; background:rgba(57,197,187,0.15); border:1px solid rgba(57,197,187,0.4); color:#fff; padding:4px; border-radius:6px; cursor:pointer;">Wave</button>
    <button id="btn-test-think" style="flex:1 1 30%; background:rgba(57,197,187,0.15); border:1px solid rgba(57,197,187,0.4); color:#fff; padding:4px; border-radius:6px; cursor:pointer;">Thinking</button>
    <button id="btn-test-proud" style="flex:1 1 30%; background:rgba(57,197,187,0.15); border:1px solid rgba(57,197,187,0.4); color:#fff; padding:4px; border-radius:6px; cursor:pointer;">Proud</button>
  </div>
`;
document.body.appendChild(hud);

let hudVisible = false;
function toggleHud(): void {
  hudVisible = !hudVisible;
  hud.style.display = hudVisible ? "block" : "none";
}

window.addEventListener("keydown", (e) => {
  if (e.key === "F2") {
    e.preventDefault();
    toggleHud();
  }
});

hud.querySelector("#hud-close")?.addEventListener("click", () => toggleHud());

hud.querySelector("#btn-vrma-only")?.addEventListener("click", () => {
  if (stage.motion) {
    const next = !stage.motion.knownGoodVrmaOnly;
    stage.motion.setKnownGoodVrmaOnly(next);
    const btn = hud.querySelector("#btn-vrma-only") as HTMLButtonElement;
    btn.style.background = next ? "rgba(255,80,80,0.3)" : "rgba(255,170,0,0.2)";
    btn.textContent = next ? "🛑 순수 VRMA 격리 모드 활성 (클릭시 해제)" : "🔬 순수 VRMA만 재생 (Rig 진단)";
  }
});

hud.querySelector("#btn-toggle-proc")?.addEventListener("click", () => {
  if (stage.motion) {
    const on = stage.motion.toggleProcedural();
    const btn = hud.querySelector("#btn-toggle-proc") as HTMLButtonElement;
    btn.textContent = `호흡/손가락: ${on ? "ON" : "OFF"}`;
  }
});

hud.querySelector("#btn-test-idle")?.addEventListener("click", () => stage.play("idle"));
hud.querySelector("#btn-test-wave")?.addEventListener("click", () => stage.play("wave"));
hud.querySelector("#btn-test-think")?.addEventListener("click", () => stage.play("think"));
hud.querySelector("#btn-test-proud")?.addEventListener("click", () => stage.play("explain"));

setInterval(() => {
  if (!hudVisible || !stage.motion) return;
  const s = stage.motion.getDebugStatus();
  const statusEl = hud.querySelector("#hud-status");
  if (statusEl) {
    statusEl.innerHTML = `
      <div><strong>Active Gesture:</strong> <span style="color:#39c5bb;">${s.gesture}</span> (${s.time})</div>
      <div><strong>Gesture Wt:</strong> ${s.gestureWeight} | <strong>Idle Wt:</strong> ${s.idleWeight}</div>
      <div><strong>Speaking:</strong> ${s.isSpeaking ? '<span style="color:#aaffaa;">YES</span>' : 'NO'}</div>
      <div><strong>Procedural Dynamics:</strong> ${s.procedural ? 'ON' : '<span style="color:#ff8888;">OFF</span>'}</div>
      <div><strong>Rig Test Isolation:</strong> ${s.knownGoodVrmaOnly ? '<span style="color:#ffaa44;">VRMA ONLY</span>' : 'Normal Layered'}</div>
    `;
  }
}, 100);

// ============================================================================
// Right-Click Context Menu for Character Window
// ============================================================================
const ctxMenu = document.createElement("div");
ctxMenu.id = "ctx-menu";
ctxMenu.style.cssText = "display:none; position:fixed; z-index:99999; background:rgba(10,18,28,0.96); border:1px solid rgba(57,197,187,0.4); border-radius:12px; padding:6px; box-shadow:0 8px 30px rgba(0,0,0,0.6); backdrop-filter:blur(20px); font:12px/1.4 'Segoe UI',sans-serif; min-width:160px; color:#e8fbff; user-select:none;";
ctxMenu.innerHTML = `
  <div style="padding:4px 8px; font-size:10px; font-weight:700; color:#39c5bb; border-bottom:1px solid rgba(57,197,187,0.2); margin-bottom:4px;">🎭 AI 캐릭터챗 메뉴</div>
  <div class="ctx-item" data-act="view-full" style="padding:5px 8px; border-radius:6px; cursor:pointer; display:flex; gap:6px; align-items:center;">🧍 전신 모드</div>
  <div class="ctx-item" data-act="view-upper" style="padding:5px 8px; border-radius:6px; cursor:pointer; display:flex; gap:6px; align-items:center;">👤 상반신 모드</div>
  <div class="ctx-item" data-act="view-pip" style="padding:5px 8px; border-radius:6px; cursor:pointer; display:flex; gap:6px; align-items:center;">🪟 PIP 미니 위젯</div>
  <div style="height:1px; background:rgba(57,197,187,0.2); margin:4px 0;"></div>
  <div class="ctx-item" data-act="toggle-motion-hud" style="padding:5px 8px; border-radius:6px; cursor:pointer; display:flex; gap:6px; align-items:center;">⚡ 모션/상태 HUD 토글</div>
  <div class="ctx-item" data-act="toggle-chat" style="padding:5px 8px; border-radius:6px; cursor:pointer; display:flex; gap:6px; align-items:center;">💬 채팅창 토글</div>
  <div class="ctx-item" data-act="toggle-mute" style="padding:5px 8px; border-radius:6px; cursor:pointer; display:flex; gap:6px; align-items:center;">🔊 음소거 토글</div>
  <div class="ctx-item" data-act="open-settings" style="padding:5px 8px; border-radius:6px; cursor:pointer; display:flex; gap:6px; align-items:center;">⚙️ 환경설정</div>
  <div style="height:1px; background:rgba(255,107,138,0.2); margin:4px 0;"></div>
  <div class="ctx-item" data-act="quit" style="padding:5px 8px; border-radius:6px; cursor:pointer; color:#ff6b8a; display:flex; gap:6px; align-items:center;">❌ 프로그램 종료</div>
`;
document.body.appendChild(ctxMenu);

let lastMouseX = 0;
let lastMouseY = 0;

function isOverInteractiveUI(x: number, y: number): boolean {
  if (ctxMenu && ctxMenu.style.display === "block") {
    const r = ctxMenu.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  if (hudVisible && hud && hud.style.display === "block") {
    const r = hud.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  const motionHud = document.getElementById("motion-debug-hud");
  if (motionHud && motionHud.style.display !== "none") {
    const r = motionHud.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}

function closeContextMenu(clientX?: number, clientY?: number): void {
  if (ctxMenu.style.display !== "block") return;
  ctxMenu.style.display = "none";
  const cx = clientX ?? lastMouseX;
  const cy = clientY ?? lastMouseY;
  const hit = isOverInteractiveUI(cx, cy) || stage.hitTest(cx, cy);
  lastHit = hit;
  window.miku.send(Ipc.SET_CLICK_THROUGH, !hit);
}

function handleMenuAction(act: string | undefined): void {
  if (!act) return;
  closeContextMenu();

  if (act === "view-full") window.miku.send(Ipc.SET_VIEW_MODE, "full");
  else if (act === "view-upper") window.miku.send(Ipc.SET_VIEW_MODE, "upper");
  else if (act === "view-pip") window.miku.send(Ipc.SET_VIEW_MODE, "pip");
  else if (act === "toggle-motion-hud") {
    const mHud = document.getElementById("motion-debug-hud");
    if (mHud) {
      mHud.style.display = mHud.style.display === "none" ? "block" : "none";
    }
  }
  else if (act === "toggle-chat") window.miku.send(Ipc.TOGGLE_CHAT_WINDOW);
  else if (act === "toggle-mute") window.miku.send(Ipc.TOGGLE_MUTE);
  else if (act === "open-settings") window.miku.send(Ipc.OPEN_SETTINGS);
  else if (act === "quit") window.miku.send(Ipc.QUIT_APP);
}

ctxMenu.querySelectorAll(".ctx-item").forEach((el) => {
  el.addEventListener("mouseenter", () => (el as HTMLElement).style.background = "rgba(57,197,187,0.25)");
  el.addEventListener("mouseleave", () => (el as HTMLElement).style.background = "transparent");
  el.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
  });
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const act = (el as HTMLElement).dataset.act;
    handleMenuAction(act);
  });
});

// Auto-close context menu when window loses focus (e.g. clicking another application)
window.addEventListener("blur", () => {
  closeContextMenu();
});

// ============================================================================
// Window Dragging & Click-through Hit Test
// ============================================================================
let dragLogCounter = 0;

window.addEventListener("pointermove", (ev) => {
  lastMouseX = ev.clientX;
  lastMouseY = ev.clientY;

  if (isDragging) {
    if (!hasDragged && Math.hypot(ev.screenX - dragStartX, ev.screenY - dragStartY) > 4) {
      hasDragged = true;
    }
    const dx = Math.round(ev.screenX - lastScreenX);
    const dy = Math.round(ev.screenY - lastScreenY);
    lastScreenX = ev.screenX;
    lastScreenY = ev.screenY;

    if (hasDragged && (dx !== 0 || dy !== 0)) {
      window.miku.send(Ipc.WINDOW_DRAG, { dx, dy });
    }

    dragLogCounter++;
    if (dragLogCounter % 20 === 0) {
      const diag = stage.getDragDiagnostics();
      console.log(`[DRAG RUNTIME] pos:(${diag.vrmPosition?.x},${diag.vrmPosition?.y},${diag.vrmPosition?.z}) scale:(${diag.vrmScale?.x},${diag.vrmScale?.y},${diag.vrmScale?.z}) camDist:${diag.cameraDistance} fov:${diag.cameraFov} bounds:${diag.viewport?.innerWidth}x${diag.viewport?.innerHeight}`);
    }
    return;
  }

  // When context menu is open, window MUST receive mouse clicks (hit = true)
  // so hover highlights and menu item clicks are never lost or forwarded to desktop!
  const isMenuOpen = ctxMenu.style.display === "block";
  const hit = isMenuOpen || isOverInteractiveUI(ev.clientX, ev.clientY) || stage.hitTest(ev.clientX, ev.clientY);
  if (hit !== lastHit) {
    lastHit = hit;
    window.miku.send(Ipc.SET_CLICK_THROUGH, !hit);
  }
});

window.addEventListener("pointerdown", (ev) => {
  // If context menu is open:
  if (ctxMenu.style.display === "block") {
    if (ctxMenu.contains(ev.target as Node)) {
      // Clicked inside context menu: let the menu item handler process it!
      return;
    } else {
      // Clicked outside context menu: dismiss it without dragging
      closeContextMenu(ev.clientX, ev.clientY);
      return;
    }
  }

  // If clicking HUD controls, let HUD button handlers execute
  if (hudVisible && isOverInteractiveUI(ev.clientX, ev.clientY)) {
    return;
  }

  // Left-click on character mesh initiates dragging
  if (ev.button === 0 && stage.hitTest(ev.clientX, ev.clientY)) {
    isDragging = true;
    hasDragged = false;
    dragStartX = ev.screenX;
    dragStartY = ev.screenY;
    lastScreenX = ev.screenX;
    lastScreenY = ev.screenY;

    const diag = stage.getDragDiagnostics();
    console.log(`[DRAG START] pos:(${diag.vrmPosition?.x},${diag.vrmPosition?.y},${diag.vrmPosition?.z}) scale:(${diag.vrmScale?.x},${diag.vrmScale?.y},${diag.vrmScale?.z}) camDist:${diag.cameraDistance} fov:${diag.cameraFov} bounds:${diag.viewport?.innerWidth}x${diag.viewport?.innerHeight}`);
  }
});

window.addEventListener("pointerup", () => {
  if (isDragging) {
    isDragging = false;
    const diag = stage.getDragDiagnostics();
    console.log(`[DRAG END] pos:(${diag.vrmPosition?.x},${diag.vrmPosition?.y},${diag.vrmPosition?.z}) scale:(${diag.vrmScale?.x},${diag.vrmScale?.y},${diag.vrmScale?.z}) camDist:${diag.cameraDistance} fov:${diag.cameraFov} bounds:${diag.viewport?.innerWidth}x${diag.viewport?.innerHeight}`);
  }
});

window.addEventListener("pointercancel", () => {
  if (isDragging) {
    isDragging = false;
  }
});

// Right click opens context menu
window.addEventListener("contextmenu", (ev) => {
  if (isDragging || hasDragged) {
    ev.preventDefault();
    return;
  }
  if (stage.hitTest(ev.clientX, ev.clientY)) {
    ev.preventDefault();
    ctxMenu.style.display = "block";
    // Ensure mouse events are received
    lastHit = true;
    window.miku.send(Ipc.SET_CLICK_THROUGH, false);

    const menuW = 170;
    const menuH = 260;
    const x = Math.min(window.innerWidth - menuW - 8, Math.max(8, ev.clientX));
    const y = Math.min(window.innerHeight - menuH - 8, Math.max(8, ev.clientY));
    ctxMenu.style.left = x + "px";
    ctxMenu.style.top = y + "px";
  } else {
    closeContextMenu(ev.clientX, ev.clientY);
  }
});

// Click reaction with dynamic varied interactions
const clickReactions: { gesture: GestureName; emotion: EmotionName }[] = [
  { gesture: "peace", emotion: "happy" },
  { gesture: "giggle", emotion: "happy" },
  { gesture: "curious", emotion: "relaxed" },
  { gesture: "cheer", emotion: "happy" },
];
let clickIdx = 0;

window.addEventListener("click", (ev) => {
  if (hasDragged) { hasDragged = false; return; }
  if (ctxMenu.contains(ev.target as Node)) return;
  if (isOverInteractiveUI(ev.clientX, ev.clientY)) return;
  if (stage.hitTest(ev.clientX, ev.clientY)) {
    const rx = clickReactions[clickIdx % clickReactions.length];
    clickIdx++;
    stage.setEmotion(rx.emotion);
    stage.play(rx.gesture);
    setTimeout(() => stage.setEmotion("neutral"), 2600);
  }
});

// Mouse wheel scaling ONLY with Ctrl key (prevents touchpad/drag accidental scaling)
window.addEventListener("wheel", (ev) => {
  if (isDragging) return;
  if (!ev.ctrlKey) return;
  if (stage.hitTest(ev.clientX, ev.clientY)) {
    ev.preventDefault();
    const delta = ev.deltaY < 0 ? 0.05 : -0.05;
    currentScale = Math.max(0.5, Math.min(2.0, currentScale + delta));
    stage.setScale(currentScale);
  }
}, { passive: false });

window.addEventListener("keydown", (ev) => {
  if (ev.code === "Space" && !ev.repeat) {
    ev.preventDefault();
    window.miku.send(Ipc.PTT_START);
  }
});
window.addEventListener("keyup", (ev) => {
  if (ev.code === "Space") window.miku.send(Ipc.PTT_STOP);
});

// Double click character to toggle chat window
window.addEventListener("dblclick", (ev) => {
  if (stage.hitTest(ev.clientX, ev.clientY)) {
    window.miku.send(Ipc.TOGGLE_CHAT_WINDOW);
  }
});

window.miku.on(Ipc.SET_VIEW_MODE, (mode: unknown) => {
  if (typeof mode === "string") {
    stage.setViewMode(mode as ViewMode);
  }
});

speechSynthesis.addEventListener("voiceschanged", () => koreanVoice());

async function bootApp(): Promise<void> {
  try {
    setBoot("VRM 로딩…");
    await stage.load("./models/HatsuneMikuNT.vrm", "./models/idle_loop.vrma");
    if (!stage.gestures) throw new Error("GestureEngine was not constructed");
    setBoot("");
    window.miku.send(Ipc.READY);
    stage.play("idle");
  } catch (err) {
    setBoot("모델 로드 실패: " + String(err));
  }
}

void bootApp();

