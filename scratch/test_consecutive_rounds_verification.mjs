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

server.listen(8775, "127.0.0.1", async () => {
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

  await win.loadURL("http://127.0.0.1:8775/index.html");
  await new Promise((r) => setTimeout(r, 4000));

  console.log("\n=======================================================");
  console.log("TEST A: CONSECUTIVE 3-ROUND TRIGGERING VIA MOTION EVENT BUS");
  console.log("=======================================================");

  const gestureTestList = ["wave", "nod", "think", "explain", "laugh"];
  const consecutiveResults = [];

  for (const gestureName of gestureTestList) {
    console.log(`\n--- Testing Gesture: ${gestureName} (3 Consecutive Rounds) ---`);
    const rounds = [];

    for (let round = 1; round <= 3; round++) {
      // Trigger purely via MotionEventBus
      const roundData = await win.webContents.executeJavaScript(`
        (async () => {
          const bus = window.__motionEventBus;
          const stage = window.stage;
          const motion = stage?.motion;
          const vrm = stage?.vrm;
          const action = motion?.gestureActions?.get("${gestureName}");
          const rHand = vrm?.humanoid?.getNormalizedBoneNode("rightHand");
          const head = vrm?.humanoid?.getNormalizedBoneNode("head");
          const hips = vrm?.humanoid?.getNormalizedBoneNode("hips");

          // 1. user:submit -> listening
          bus.emit({ type: "user:submit", payload: { text: "테스트" } });
          await new Promise(r => setTimeout(r, 100));

          // 2. llm:firstToken -> speaking
          bus.emit({ type: "llm:firstToken", payload: { token: "안녕" } });
          await new Promise(r => setTimeout(r, 100));

          // 3. llm:intent -> trigger target gesture
          bus.emit({ type: "llm:intent", payload: { gesture: "${gestureName}" } });
          
          // Capture action state immediately upon playback start
          const startTime = action ? Number(action.time.toFixed(3)) : -1;
          const isPaused = action ? action.paused : true;
          const isEnabled = action ? action.enabled : false;

          const startHandY = rHand ? (rHand.matrixWorld.elements[13] || 0) : 0;
          const startHeadX = head ? head.rotation.x : 0;

          // Wait 600ms for gesture motion peak
          await new Promise(r => setTimeout(r, 600));

          const peakHandY = rHand ? (rHand.matrixWorld.elements[13] || 0) : 0;
          const peakHeadX = head ? head.rotation.x : 0;
          const handDeltaY = Number(Math.abs(peakHandY - startHandY).toFixed(3));
          const headDeltaX = Number(Math.abs(peakHeadX - startHeadX).toFixed(3));

          // 4. tts:end -> afterglow
          bus.emit({ type: "tts:end" });

          // Wait 1.8s for afterglow & crossfade back to idle
          await new Promise(r => setTimeout(r, 1800));

          // Check end state: ensure arm is not in T-pose (Z rotation != 0) and hips didn't jump
          const armRotZ = vrm?.humanoid?.getNormalizedBoneNode("leftUpperArm")?.rotation?.z ?? 0;
          const hipsY = vrm?.humanoid?.getNormalizedBoneNode("hips")?.matrixWorld?.elements[13] ?? 0;

          return {
            round: ${round},
            startTime,
            isPaused,
            isEnabled,
            handDeltaY,
            headDeltaX,
            tPoseJump: Math.abs(armRotZ) < 0.2, // T-pose is ~0.0, natural A-pose is ~1.3
            normalPlayback: (startTime >= 0 && (!isPaused) && isEnabled && (handDeltaY > 0.05 || headDeltaX > 0.05))
          };
        })()
      `);

      rounds.push(roundData);
      console.log(`Round ${round}:`, JSON.stringify(roundData));
      // Short pause between rounds
      await new Promise((r) => setTimeout(r, 200));
    }
    consecutiveResults.push({ gesture: gestureName, rounds });
  }

  console.log("\n=======================================================");
  console.log("TEST B: 60+ SECONDS ACCUMULATED MIXER TIME TEST (BUG 1 VERIFICATION)");
  console.log("=======================================================");

  const timeAccumTest = await win.webContents.executeJavaScript(`
    (async () => {
      const stage = window.stage;
      const motion = stage?.motion;
      const bus = window.__motionEventBus;

      // Fast-forward mixer cumulative time by 75.0 seconds!
      const mixer = motion?.mixer;
      const beforeTime = mixer ? mixer.time : 0;
      
      // Simulate 75 seconds of idle ticking in the mixer
      mixer.update(75.0);
      const afterTime = mixer.time;

      // Now trigger 'wave' via MotionEventBus
      bus.emit({ type: "user:submit", payload: { text: "60초 후 테스트" } });
      await new Promise(r => setTimeout(r, 100));
      bus.emit({ type: "llm:firstToken", payload: { token: "웨이브" } });
      await new Promise(r => setTimeout(r, 100));
      bus.emit({ type: "llm:intent", payload: { gesture: "wave" } });

      const waveAction = motion.gestureActions.get("wave");
      const startTime = Number(waveAction.time.toFixed(3));
      const isPausedAtStart = waveAction.paused;
      const isEnabledAtStart = waveAction.enabled;

      // Sample hand height during wave
      const rHand = stage.vrm?.humanoid?.getNormalizedBoneNode("rightHand");
      const startHandY = rHand ? rHand.matrixWorld.elements[13] : 0;

      await new Promise(r => setTimeout(r, 700));
      const peakHandY = rHand ? rHand.matrixWorld.elements[13] : 0;
      const handDeltaY = Number(Math.abs(peakHandY - startHandY).toFixed(3));

      bus.emit({ type: "tts:end" });
      await new Promise(r => setTimeout(r, 1800));

      return {
        accumulatedMixerTime: Number(afterTime.toFixed(2)),
        timeDifferenceFromBefore: Number((afterTime - beforeTime).toFixed(2)),
        gestureStartTime: startTime,
        expectedStartTime: 1.10,
        jumpedToEndImmediately: startTime > 2.0, // If Bug 1 existed, it would jump past clip duration (5.1s)
        isPausedAtStart,
        isEnabledAtStart,
        handDeltaY,
        normalPlaybackAfter60s: (startTime === 1.10 && handDeltaY > 0.1 && (!isPausedAtStart))
      };
    })()
  `);

  console.log("60s Mixer Time Accumulation Result:");
  console.log(JSON.stringify(timeAccumTest, null, 2));

  server.close();
  app.quit();
});
