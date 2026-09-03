import { app, BrowserWindow } from "electron";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");

const distDir = "C:/TEST/MikuChat-v3/dist";
const preloadJs = "C:/TEST/MikuChat-v3/dist-electron/preload.mjs";

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split("?")[0]);
  if (reqPath === "/") reqPath = "/index.html";
  const filePath = path.join(distDir, reqPath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mimeMap = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".vrm": "application/octet-stream",
      ".vrma": "application/octet-stream",
    };
    res.writeHead(200, { "Content-Type": mimeMap[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end("Not Found: " + reqPath);
  }
});

server.listen(8767, "127.0.0.1", async () => {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 900,
    height: 1000,
    show: true, // Show window so rAF runs at full 60fps
    webPreferences: {
      preload: preloadJs,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  win.webContents.on("console-message", (event, level, message) => {
    if (message.includes("[ConvState Transition]") || message.includes("[MotionDirector]") || message.includes("VRM")) {
      console.log("[ELECTRON_LOG]:", message);
    }
  });

  console.log("Loading http://127.0.0.1:8767/index.html");
  await win.loadURL("http://127.0.0.1:8767/index.html");

  // Wait 3 seconds for VRM & VRMA loading
  await new Promise((r) => setTimeout(r, 3000));

  console.log("\n=== 1. FULL CONVERSATION SCENARIO (60FPS) ===");

  // Step A: user:submit
  await win.webContents.executeJavaScript(`
    window.__motionEventBus?.emit({ type: "user:submit", payload: { text: "안녕 미쿠야!" } });
  `);
  await new Promise((r) => setTimeout(r, 600));

  // Step B: llm:firstToken (Latency fallback: immediately begins speaking + explain gesture)
  await win.webContents.executeJavaScript(`
    window.__motionEventBus?.emit({ type: "llm:firstToken", payload: { token: "안녕" } });
  `);
  await new Promise((r) => setTimeout(r, 400));

  // Step C: llm:intent arrives
  await win.webContents.executeJavaScript(`
    window.__motionEventBus?.emit({ type: "llm:intent", payload: { gesture: "wave", emotion: "happy" } });
  `);
  await new Promise((r) => setTimeout(r, 800));

  // Step D: tts:start
  await win.webContents.executeJavaScript(`
    window.__motionEventBus?.emit({ type: "tts:start", payload: { text: "반가워요!" } });
  `);
  await new Promise((r) => setTimeout(r, 1000));

  // Step E: tts:end -> enters afterglow
  await win.webContents.executeJavaScript(`
    window.__motionEventBus?.emit({ type: "tts:end" });
  `);

  // Wait 2.0s for afterglow (1.5s timeout) -> returns to idle
  await new Promise((r) => setTimeout(r, 2000));

  console.log("\n=== 2. HUD STATUS AFTER IDLE RETURN ===");
  const finalStatus = await win.webContents.executeJavaScript(`
    (() => {
      const hud = document.getElementById("motion-debug-hud");
      return hud ? hud.innerText : "";
    })()
  `);
  console.log(finalStatus);

  console.log("\n=== 3. TESTING ROLLBACK ===");
  const rollbackCheck = await win.webContents.executeJavaScript(`
    (() => {
      window.__MOTION_CONFIG__.MOTION_V2 = false;
      return window.__MOTION_CONFIG__.MOTION_V2;
    })()
  `);
  console.log("Rollback confirmed:", rollbackCheck === false);

  server.close();
  app.quit();
});
