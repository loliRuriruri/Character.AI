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
      ".fbx": "application/octet-stream",
    };
    res.writeHead(200, { "Content-Type": mimeMap[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(8776, "127.0.0.1", async () => {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1024,
    height: 900,
    show: true,
    webPreferences: {
      preload: preloadJs,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  await win.loadURL("http://127.0.0.1:8776/index.html");
  await new Promise((r) => setTimeout(r, 4000));

  const bus = "__motionEventBus";

  for (let r = 1; r <= 3; r++) {
    const res = await win.webContents.executeJavaScript(`
      (async () => {
        const bus = window.__motionEventBus;
        const vrm = window.stage?.vrm;
        const rawHand = vrm?.humanoid?.getRawBoneNode("rightHand");
        const action = window.stage?.motion?.gestureActions?.get("wave");

        bus.emit({ type: "user:submit", payload: { text: "wave test" } });
        await new Promise(r => setTimeout(r, 100));
        bus.emit({ type: "llm:firstToken", payload: { token: "w" } });
        await new Promise(r => setTimeout(r, 100));
        bus.emit({ type: "llm:intent", payload: { gesture: "wave" } });

        const startTime = Number(action.time.toFixed(3));
        const isPaused = action.paused;

        // Sample initial hand pos
        rawHand?.updateWorldMatrix(true, false);
        const yStart = rawHand ? rawHand.matrixWorld.elements[13] : 0;

        // Wait 700ms for wave motion
        await new Promise(r => setTimeout(r, 700));

        rawHand?.updateWorldMatrix(true, false);
        const yPeak = rawHand ? rawHand.matrixWorld.elements[13] : 0;
        const deltaY = Number(Math.abs(yPeak - yStart).toFixed(3));

        bus.emit({ type: "tts:end" });
        await new Promise(r => setTimeout(r, 1800));

        return {
          round: ${r},
          startTime,
          isPaused,
          yStart: Number(yStart.toFixed(3)),
          yPeak: Number(yPeak.toFixed(3)),
          deltaY,
          normalPlayback: (startTime === 1.10 && !isPaused && deltaY > 0.1)
        };
      })()
    `);
    console.log("Wave Round " + r + ":", JSON.stringify(res));
  }

  // 60s mixer time test
  const timeRes = await win.webContents.executeJavaScript(`
    (async () => {
      const bus = window.__motionEventBus;
      const motion = window.stage?.motion;
      const vrm = window.stage?.vrm;
      const mixer = motion?.mixer;
      const rawHand = vrm?.humanoid?.getRawBoneNode("rightHand");
      const action = motion?.gestureActions?.get("wave");

      // Advance mixer time by 70s
      mixer.update(70.0);

      bus.emit({ type: "user:submit", payload: { text: "wave 60s" } });
      await new Promise(r => setTimeout(r, 100));
      bus.emit({ type: "llm:firstToken", payload: { token: "w" } });
      await new Promise(r => setTimeout(r, 100));
      bus.emit({ type: "llm:intent", payload: { gesture: "wave" } });

      const startTime = Number(action.time.toFixed(3));
      const isPaused = action.paused;

      rawHand?.updateWorldMatrix(true, false);
      const yStart = rawHand ? rawHand.matrixWorld.elements[13] : 0;

      await new Promise(r => setTimeout(r, 700));

      rawHand?.updateWorldMatrix(true, false);
      const yPeak = rawHand ? rawHand.matrixWorld.elements[13] : 0;
      const deltaY = Number(Math.abs(yPeak - yStart).toFixed(3));

      bus.emit({ type: "tts:end" });
      await new Promise(r => setTimeout(r, 1800));

      return {
        accumulatedMixerTime: Number(mixer.time.toFixed(2)),
        startTime,
        isPaused,
        deltaY,
        normalPlaybackAfter60s: (startTime === 1.10 && !isPaused && deltaY > 0.1)
      };
    })()
  `);
  console.log("60s Mixer Time Wave Test:", JSON.stringify(timeRes));

  server.close();
  app.quit();
});
