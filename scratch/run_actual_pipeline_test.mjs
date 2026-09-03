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

server.listen(8777, "127.0.0.1", async () => {
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

  await win.loadURL("http://127.0.0.1:8777/index.html");
  await new Promise((r) => setTimeout(r, 4000));

  console.log("=== 1. 3 CONSECUTIVE ROUNDS VIA ACTUAL EVENT BUS ===");

  const gestures = ["wave", "nod", "think", "explain", "laugh"];
  const summaryTable = [];

  for (const g of gestures) {
    for (let r = 1; r <= 3; r++) {
      const res = await win.webContents.executeJavaScript(`
        (async () => {
          const bus = window.__motionEventBus;
          const stage = window.stage;
          const motion = stage?.motion;
          const vrm = stage?.vrm;
          const action = motion?.gestureActions?.get("${g}");
          const rHand = vrm?.humanoid?.getNormalizedBoneNode("rightHand");
          const head = vrm?.humanoid?.getNormalizedBoneNode("head");

          // Initial resting values
          const y0 = rHand?.matrixWorld.elements[13] ?? 0;
          const rot0 = head?.rotation.x ?? 0;

          // 1. user:submit
          bus.emit({ type: "user:submit", payload: { text: "대화 테스트" } });
          await new Promise(res => setTimeout(res, 80));

          // 2. llm:firstToken
          bus.emit({ type: "llm:firstToken", payload: { token: "안녕" } });
          await new Promise(res => setTimeout(res, 80));

          // 3. llm:intent -> triggers target gesture
          bus.emit({ type: "llm:intent", payload: { gesture: "${g}" } });

          // Capture start properties immediately
          const startTime = action ? Number(action.time.toFixed(3)) : -1;
          const isPausedAtStart = action ? action.paused : true;
          const isEnabledAtStart = action ? action.enabled : false;

          // Wait 900ms for gesture to reach active motion
          await new Promise(res => setTimeout(res, 900));

          const y1 = rHand?.matrixWorld.elements[13] ?? 0;
          const rot1 = head?.rotation.x ?? 0;
          const deltaY = Number(Math.abs(y1 - y0).toFixed(3));
          const deltaRotX = Number(Math.abs(rot1 - rot0).toFixed(3));

          // 4. tts:end -> afterglow
          bus.emit({ type: "tts:end" });

          // Wait 1.8s for transition back to base idle
          await new Promise(res => setTimeout(res, 1800));

          // Check end state: arm should be in resting pose (rotation.z > 0.5 rad), NOT T-pose (0.0 rad)
          const armRotZ = vrm?.humanoid?.getNormalizedBoneNode("leftUpperArm")?.rotation?.z ?? 0;
          const tPoseJump = Math.abs(armRotZ) < 0.2;
          const isNormal = (startTime >= 0) && (!isPausedAtStart) && isEnabledAtStart && (!tPoseJump);

          return {
            gesture: "${g}",
            round: ${r},
            startTime,
            handDeltaY: deltaY,
            headDeltaRotX: deltaRotX,
            tPoseJump: tPoseJump ? "발생" : "없음",
            normalPlayback: isNormal ? "정상" : "실패"
          };
        })()
      `);
      summaryTable.push(res);
      console.log(JSON.stringify(res));
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  console.log("\n=== 2. 60+ SECONDS ACCUMULATED MIXER TIME TEST (BUG 1 PROOF) ===");
  const test60s = await win.webContents.executeJavaScript(`
    (async () => {
      const bus = window.__motionEventBus;
      const stage = window.stage;
      const motion = stage?.motion;
      const vrm = stage?.vrm;
      const mixer = motion?.mixer;
      const action = motion?.gestureActions?.get("wave");
      const rHand = vrm?.humanoid?.getNormalizedBoneNode("rightHand");

      // Advance mixer accumulated time by 80.0s (exceeding 60s)
      mixer.update(80.0);
      const accTime = Number(mixer.time.toFixed(2));

      const y0 = rHand?.matrixWorld.elements[13] ?? 0;

      bus.emit({ type: "user:submit", payload: { text: "60초 경과 테스트" } });
      await new Promise(res => setTimeout(res, 80));
      bus.emit({ type: "llm:firstToken", payload: { token: "오랜만이야" } });
      await new Promise(res => setTimeout(res, 80));
      bus.emit({ type: "llm:intent", payload: { gesture: "wave" } });

      const startTime = Number(action.time.toFixed(3));
      const isPausedAtStart = action.paused;
      const isEnabledAtStart = action.enabled;

      await new Promise(res => setTimeout(res, 900));
      const y1 = rHand?.matrixWorld.elements[13] ?? 0;
      const deltaY = Number(Math.abs(y1 - y0).toFixed(3));

      bus.emit({ type: "tts:end" });
      await new Promise(res => setTimeout(res, 1800));

      return {
        accumulatedMixerTime: accTime,
        actionStartTime: startTime,
        expectedStartTime: 1.10,
        jumpedToEndImmediately: startTime > 2.0, // If Bug 1 existed, it would jump to 5.1s
        isPausedAtStart,
        isEnabledAtStart,
        handDeltaY: deltaY,
        normalPlaybackAfter60s: (startTime === 1.10 && !isPausedAtStart && isEnabledAtStart) ? "정상" : "실패"
      };
    })()
  `);

  console.log("60s Accumulated Mixer Time Test Result:");
  console.log(JSON.stringify(test60s, null, 2));

  server.close();
  app.quit();
});
