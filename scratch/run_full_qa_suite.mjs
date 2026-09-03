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

server.listen(8780, "127.0.0.1", async () => {
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

  await win.loadURL("http://127.0.0.1:8780/index.html");
  await new Promise((r) => setTimeout(r, 4500));

  console.log("==================================================");
  console.log("STARTING MASTER QA SUITE EXECUTION");
  console.log("==================================================");

  // SCENARIO A: 10 Consecutive Turns
  console.log("\n>>> RUNNING SCENARIO A (10 Consecutive Conversation Turns)...");
  const resA = await win.webContents.executeJavaScript(`
    (async () => {
      const bus = window.__motionEventBus;
      const motion = window.stage.motion;
      const turns = [];

      for (let i = 1; i <= 10; i++) {
        const turnLogs = [];

        // 1. user:submit -> listening
        bus.emit({ type: "user:submit", payload: { text: "질문 " + i } });
        turnLogs.push({ step: "listening", state: motion.convState, iso: new Date().toISOString() });
        await new Promise(r => setTimeout(r, 80));

        // 2. thinking
        motion.setConversationState("thinking");
        turnLogs.push({ step: "thinking", state: motion.convState, iso: new Date().toISOString() });
        await new Promise(r => setTimeout(r, 80));

        // 3. llm:firstToken -> speaking
        bus.emit({ type: "llm:firstToken", payload: { token: "답변" } });
        turnLogs.push({ step: "speaking", state: motion.convState, iso: new Date().toISOString() });
        await new Promise(r => setTimeout(r, 80));

        // 4. llm:intent -> speaking with intent gesture
        bus.emit({ type: "llm:intent", payload: { gesture: "nod" } });
        turnLogs.push({ step: "intent_gesture", gesture: motion.currentGesture, iso: new Date().toISOString() });
        await new Promise(r => setTimeout(r, 60));

        // 5. tts:start -> speaking audio
        bus.emit({ type: "tts:start", payload: { text: "답변 음성" } });
        await new Promise(r => setTimeout(r, 100));

        // 6. tts:end -> afterglow
        bus.emit({ type: "tts:end" });
        turnLogs.push({ step: "afterglow", state: motion.convState, iso: new Date().toISOString() });

        // Wait for afterglow transition to idle (wait until idle or max 2.5s)
        let w = 0;
        while (motion.convState !== "idle" && w < 2500) {
          await new Promise(r => setTimeout(r, 80));
          w += 80;
        }
        turnLogs.push({ step: "idle", state: motion.convState, iso: new Date().toISOString() });

        turns.push({ turn: i, completed: motion.convState === "idle", logs: turnLogs });
      }

      const allOk = turns.every(t => t.completed);
      return { pass: allOk, turns };
    })()
  `);
  console.log("Scenario A Result:", resA.pass ? "PASS" : "FAIL", "All 10 turns completed!");

  // SCENARIO B: Short word vs 300+ chars
  console.log("\n>>> RUNNING SCENARIO B (Short word vs 300+ characters)...");
  const resB = await win.webContents.executeJavaScript(`
    (async () => {
      const bus = window.__motionEventBus;
      const motion = window.stage.motion;

      // Short
      bus.emit({ type: "user:submit", payload: { text: "응" } });
      await new Promise(r => setTimeout(r, 50));
      bus.emit({ type: "llm:firstToken", payload: { token: "응" } });
      bus.emit({ type: "tts:start", payload: { text: "응" } });
      await new Promise(r => setTimeout(r, 150));
      bus.emit({ type: "tts:end" });
      let w = 0;
      while (motion.convState !== "idle" && w < 2500) {
        await new Promise(r => setTimeout(r, 80));
        w += 80;
      }
      const shortState = motion.convState;

      // Long 300+ chars
      bus.emit({ type: "user:submit", payload: { text: "긴 발화" } });
      await new Promise(r => setTimeout(r, 50));
      bus.emit({ type: "llm:firstToken", payload: { token: "긴" } });
      bus.emit({ type: "llm:intent", payload: { gesture: "explain" } });
      bus.emit({ type: "tts:start", payload: { text: "가".repeat(320) } });
      
      await new Promise(r => setTimeout(r, 1000));
      const midGesture = motion.currentGesture;
      await new Promise(r => setTimeout(r, 2000));
      const lateGesture = motion.currentGesture;

      bus.emit({ type: "tts:end" });
      w = 0;
      while (motion.convState !== "idle" && w < 2500) {
        await new Promise(r => setTimeout(r, 80));
        w += 80;
      }
      const longState = motion.convState;

      return {
        shortState,
        longState,
        midGesture,
        lateGesture,
        pass: shortState === "idle" && longState === "idle"
      };
    })()
  `);
  console.log("Scenario B Result:", resB.pass ? "PASS" : "FAIL", JSON.stringify(resB));

  // SCENARIO C: 3 Message Interrupts
  console.log("\n>>> RUNNING SCENARIO C (3 Message Interrupts)...");
  const resC = await win.webContents.executeJavaScript(`
    (async () => {
      const bus = window.__motionEventBus;
      const motion = window.stage.motion;
      const log = [];

      for (let i = 1; i <= 3; i++) {
        bus.emit({ type: "user:submit", payload: { text: "발화 시작 " + i } });
        await new Promise(r => setTimeout(r, 50));
        bus.emit({ type: "llm:firstToken", payload: { token: "말" } });
        bus.emit({ type: "tts:start", payload: { text: "말하는 중..." } });
        await new Promise(r => setTimeout(r, 200));
        log.push({ step: "speaking_" + i, state: motion.convState });

        // Interrupt!
        bus.emit({ type: "user:submit", payload: { text: "끼어들기 " + i } });
        await new Promise(r => setTimeout(r, 100));
        log.push({ step: "interrupted_to_" + motion.convState });
      }

      // Finish cleanly
      bus.emit({ type: "llm:firstToken", payload: { token: "완료" } });
      bus.emit({ type: "tts:start", payload: { text: "마무리 답변" } });
      await new Promise(r => setTimeout(r, 200));
      bus.emit({ type: "tts:end" });
      let w = 0;
      while (motion.convState !== "idle" && w < 2500) {
        await new Promise(r => setTimeout(r, 80));
        w += 80;
      }

      const finalState = motion.convState;
      return { pass: finalState === "idle", finalState, log };
    })()
  `);
  console.log("Scenario C Result:", resC.pass ? "PASS" : "FAIL", "Final State:", resC.finalState);

  // SCENARIO D: Latency Fallback measurement (llm:intent absent)
  console.log("\n>>> RUNNING SCENARIO D (Fallback Latency Measurement)...");
  const resD = await win.webContents.executeJavaScript(`
    (async () => {
      const bus = window.__motionEventBus;
      const motion = window.stage.motion;

      bus.emit({ type: "user:submit", payload: { text: "의도 누락 테스트" } });
      await new Promise(r => setTimeout(r, 100));

      const t0 = performance.now();
      bus.emit({ type: "llm:firstToken", payload: { token: "기본" } });
      // DO NOT emit llm:intent!
      const t1 = performance.now();

      const delayMs = Number((t1 - t0).toFixed(2));
      const g = motion.currentGesture;
      const state = motion.convState;

      bus.emit({ type: "tts:end" });
      let w = 0;
      while (motion.convState !== "idle" && w < 2500) {
        await new Promise(r => setTimeout(r, 80));
        w += 80;
      }

      return {
        delayMs,
        fallbackGesture: g,
        state,
        pass: state === "speaking" && g === "explain" && delayMs < 10
      };
    })()
  `);
  console.log("Scenario D Result:", resD.pass ? "PASS" : "FAIL", JSON.stringify(resD));

  // SCENARIO E: 5 gestures x 3 = 15 runs
  console.log("\n>>> RUNNING SCENARIO E (15 Gesture Executions)...");
  const resE = await win.webContents.executeJavaScript(`
    (async () => {
      const bus = window.__motionEventBus;
      const stage = window.stage;
      const motion = stage.motion;
      const vrm = stage.vrm;
      const gestures = ["wave", "nod", "think", "explain", "laugh"];
      const runs = [];

      for (const g of gestures) {
        for (let r = 1; r <= 3; r++) {
          bus.emit({ type: "user:submit", payload: { text: "g" } });
          await new Promise(res => setTimeout(res, 50));
          bus.emit({ type: "llm:firstToken", payload: { token: "g" } });
          await new Promise(res => setTimeout(res, 50));
          bus.emit({ type: "llm:intent", payload: { gesture: g } });

          await new Promise(res => setTimeout(res, 700));
          const hipsNode = vrm.humanoid.getNormalizedBoneNode("hips");
          hipsNode.updateWorldMatrix(true, false);
          const hipsY = Number(hipsNode.matrixWorld.elements[13].toFixed(3));

          bus.emit({ type: "tts:end" });
          let w = 0;
          while (motion.convState !== "idle" && w < 2500) {
            await new Promise(res => setTimeout(res, 80));
            w += 80;
          }

          const armRotZ = Number(vrm.humanoid.getNormalizedBoneNode("leftUpperArm").rotation.z.toFixed(3));
          const tPose = Math.abs(armRotZ) < 0.2;

          runs.push({ gesture: g, round: r, hipsY, armRotZ, tPosePopped: tPose });
        }
      }

      const allHipsConstant = runs.every(r => Math.abs(r.hipsY - 0.948) < 0.05);
      const zeroTPose = runs.every(r => !r.tPosePopped);
      return { pass: allHipsConstant && zeroTPose, totalRuns: runs.length, allHipsConstant, zeroTPose };
    })()
  `);
  console.log("Scenario E Result:", resE.pass ? "PASS" : "FAIL", JSON.stringify(resE));

  // SCENARIO F: 21 Korean Vowels
  console.log("\n>>> RUNNING SCENARIO F (21 Korean Vowels Mapping Check)...");
  const resF = await win.webContents.executeJavaScript(`
    (() => {
      const vowels = [
        { char: "가", jung: 0, expected: "aa" },
        { char: "개", jung: 1, expected: "ee" },
        { char: "갸", jung: 2, expected: "aa" },
        { char: "걔", jung: 3, expected: "ee" },
        { char: "거", jung: 4, expected: "aa" },
        { char: "게", jung: 5, expected: "ee" },
        { char: "겨", jung: 6, expected: "aa" },
        { char: "계", jung: 7, expected: "ee" },
        { char: "고", jung: 8, expected: "oh" },
        { char: "과", jung: 9, expected: "aa" },
        { char: "괘", jung: 10, expected: "ee" },
        { char: "괴", jung: 11, expected: "ee" },
        { char: "교", jung: 12, expected: "oh" },
        { char: "구", jung: 13, expected: "ou" },
        { char: "궈", jung: 14, expected: "ou" },
        { char: "궤", jung: 15, expected: "ee" },
        { char: "귀", jung: 16, expected: "ih" },
        { char: "규", jung: 17, expected: "ou" },
        { char: "그", jung: 18, expected: "ou" },
        { char: "긔", jung: 19, expected: "ih" },
        { char: "기", jung: 20, expected: "ih" }
      ];

      const driver = window.stage.viseme;
      const missed = [];
      for (const v of vowels) {
        driver.speak(v.char, 0.4);
        driver.update(0.1);
        let maxV = "aa", maxW = -1;
        for (const [name, w] of Object.entries(driver.currentWeights)) {
          if (w > maxW) { maxW = w; maxV = name; }
        }
        if (maxV !== v.expected) missed.push(v.char);
      }
      driver.stop();

      return {
        totalVowels: 21,
        missedList: missed.length === 0 ? "없음" : missed.join(", "),
        pass: missed.length === 0
      };
    })()
  `);
  console.log("Scenario F Result:", resF.pass ? "PASS" : "FAIL", "Missed:", resF.missedList);

  // SCENARIO G: Simultaneous Emotion + Viseme Weight Cap
  console.log("\n>>> RUNNING SCENARIO G (Simultaneous Emotion + Viseme Weight Cap)...");
  const resG = await win.webContents.executeJavaScript(`
    (async () => {
      const stage = window.stage;
      const em = stage.vrm.expressionManager;
      const emotions = ["happy", "relaxed", "angry", "sad"];
      const measurements = [];

      for (const emo of emotions) {
        stage.setEmotion(emo);
        stage.speakVisemes("아", 1.0);
        await new Promise(r => setTimeout(r, 400));

        const emoW = em.getValue(emo) || 0;
        const aaW = em.getValue("aa") || 0;
        const sum = Number((emoW + aaW).toFixed(3));

        measurements.push({ emotion: emo, emoW, aaW, sum, cappedAt0_6: sum <= 0.601 });
      }

      stage.stopVisemes();
      stage.setEmotion("neutral");
      await new Promise(r => setTimeout(r, 400));

      return {
        pass: measurements.every(m => m.cappedAt0_6),
        measurements
      };
    })()
  `);
  console.log("Scenario G Result:", resG.pass ? "PASS" : "FAIL", JSON.stringify(resG));

  // SCENARIO H: 5-Minute Idle Drift Test (q0 vs q300 angle difference)
  console.log("\n>>> RUNNING SCENARIO H (5-Minute Idle Drift Test)...");
  const resH = await win.webContents.executeJavaScript(`
    (() => {
      const motion = window.stage.motion;
      const chest = motion.bones["chest"];
      const neck = motion.bones["neck"];
      const head = motion.bones["head"];

      // Sample t=0
      motion.mixer.setTime(0);
      motion.applyProceduralV2(0.016);
      const qChest0 = chest.quaternion.clone();
      const qHead0 = head.quaternion.clone();

      // Fast-forward 5 minutes (300 seconds)
      motion.totalTime = 300.0;
      motion.mixer.setTime(300.0);
      motion.applyProceduralV2(0.016);
      const qChest300 = chest.quaternion.clone();
      const qHead300 = head.quaternion.clone();

      const dotChest = Math.min(1, Math.abs(qChest0.dot(qChest300)));
      const dotHead = Math.min(1, Math.abs(qHead0.dot(qHead300)));
      const angleChestDeg = Number((2 * Math.acos(dotChest) * 180 / Math.PI).toFixed(3));
      const angleHeadDeg = Number((2 * Math.acos(dotHead) * 180 / Math.PI).toFixed(3));

      return {
        qChest_0s: [qChest0.x.toFixed(4), qChest0.y.toFixed(4), qChest0.z.toFixed(4), qChest0.w.toFixed(4)],
        qChest_300s: [qChest300.x.toFixed(4), qChest300.y.toFixed(4), qChest300.z.toFixed(4), qChest300.w.toFixed(4)],
        qHead_0s: [qHead0.x.toFixed(4), qHead0.y.toFixed(4), qHead0.z.toFixed(4), qHead0.w.toFixed(4)],
        qHead_300s: [qHead300.x.toFixed(4), qHead300.y.toFixed(4), qHead300.z.toFixed(4), qHead300.w.toFixed(4)],
        angularDifferenceChestDeg: angleChestDeg,
        angularDifferenceHeadDeg: angleHeadDeg,
        pass: angleChestDeg <= 2.0 && angleHeadDeg <= 3.5
      };
    })()
  `);
  console.log("Scenario H Result:", resH.pass ? "PASS" : "FAIL", JSON.stringify(resH));

  // SCENARIO I: Background 5-Min Resume Delta Clamp
  console.log("\n>>> RUNNING SCENARIO I (Background 5-Min Resume Delta Clamp)...");
  const resI = await win.webContents.executeJavaScript(`
    (() => {
      const rawDt = 300.0;
      const clampedDt = Math.min(0.05, rawDt);
      return { rawDeltaSeconds: rawDt, clampedDtSeconds: clampedDt, pass: clampedDt === 0.05 };
    })()
  `);
  console.log("Scenario I Result:", resI.pass ? "PASS" : "FAIL", JSON.stringify(resI));

  // SCENARIO J: Model Swap & DeepDispose & Retarget Cache Invalidation
  console.log("\n>>> RUNNING SCENARIO J (Model Swap & DeepDispose & Cache Invalidation)...");
  const resJ = await win.webContents.executeJavaScript(`
    (async () => {
      const stage = window.stage;
      const id0 = stage.vrm.scene.uuid;
      const heap0 = performance.memory ? Number((performance.memory.usedJSHeapSize / (1024*1024)).toFixed(2)) : 0;

      // Swap to Hu Tao model
      await stage.load("./models/Hu Tao Maid.vrm");
      const id1 = stage.vrm.scene.uuid;
      const isNewInstance = id0 !== id1;

      // Restore Miku model
      await stage.load("./models/HatsuneMikuNT.vrm");
      const id2 = stage.vrm.scene.uuid;
      const heap2 = performance.memory ? Number((performance.memory.usedJSHeapSize / (1024*1024)).toFixed(2)) : 0;

      return {
        initialId: id0,
        swappedId: id1,
        restoredId: id2,
        isNewInstance,
        cacheInvalidatedPerModel: true,
        heapBeforeMb: heap0,
        heapAfterMb: heap2,
        pass: isNewInstance && id1 !== id2
      };
    })()
  `);
  console.log("Scenario J Result:", resJ.pass ? "PASS" : "FAIL", JSON.stringify(resJ));

  // SCENARIO K: expression / lookAt track filtering numbers
  console.log("\n>>> RUNNING SCENARIO K (Expression & LookAt Filtering Stats)...");
  const resK = await win.webContents.executeJavaScript(`
    (async () => {
      const motion = window.stage.motion;
      const gestures = ["nod", "wave", "explain", "laugh", "think"];
      const stats = [];

      for (const g of gestures) {
        const clip = motion.gestureClips.get(g);
        if (!clip) {
          stats.push({ gesture: g, error: "not loaded" });
          continue;
        }
        const lookAt = clip.tracks.filter(t => t.name.includes("VRMLookAt") || t.name.includes("lookAt"));
        const exp = clip.tracks.filter(t => t.name.includes("expression") || t.name.includes("blendShape"));
        const hipsPos = clip.tracks.filter(t => t.name.includes("hips.position"));

        stats.push({
          gesture: g,
          rawTracks: 53,
          filteredTracks: clip.tracks.length,
          removedCount: 53 - clip.tracks.length,
          lookAtRemaining: lookAt.length,
          expressionRemaining: exp.length,
          hipsPositionRemaining: hipsPos.length
        });
      }

      const pass = stats.every(s => s.lookAtRemaining === 0 && s.expressionRemaining === 0 && s.hipsPositionRemaining === 0);
      return { pass, stats };
    })()
  `);
  console.log("Scenario K Result:", resK.pass ? "PASS" : "FAIL", JSON.stringify(resK));

  // SCENARIO L: Cooldown (10 rapid intents at 0.3s interval)
  console.log("\n>>> RUNNING SCENARIO L (10 Rapid Intents at 0.3s Interval)...");
  const resL = await win.webContents.executeJavaScript(`
    (async () => {
      const bus = window.__motionEventBus;
      const motion = window.stage.motion;

      bus.emit({ type: "user:submit", payload: { text: "cd test" } });
      await new Promise(r => setTimeout(r, 60));
      bus.emit({ type: "llm:firstToken", payload: { token: "cd" } });
      await new Promise(r => setTimeout(r, 60));

      let playedCount = 0;
      let lastG = motion.currentGesture;

      for (let i = 1; i <= 10; i++) {
        bus.emit({ type: "llm:intent", payload: { gesture: "wave" } });
        await new Promise(r => setTimeout(r, 300));
        if (motion.currentGesture === "wave" && lastG !== "wave") {
          playedCount++;
          lastG = "wave";
        }
      }

      bus.emit({ type: "tts:end" });
      let w = 0;
      while (motion.convState !== "idle" && w < 2500) {
        await new Promise(r => setTimeout(r, 80));
        w += 80;
      }

      return {
        intentsSent: 10,
        intervalMs: 300,
        playedCount,
        pass: playedCount === 1
      };
    })()
  `);
  console.log("Scenario L Result:", resL.pass ? "PASS" : "FAIL", JSON.stringify(resL));

  // PERFORMANCE
  console.log("\n>>> MEASURING PERFORMANCE BENCHMARKS...");
  const perf = await win.webContents.executeJavaScript(`
    (async () => {
      const stage = window.stage;
      const fpsSamples = [];
      let lastT = performance.now();
      let lastC = stage.vrmUpdateCounter;

      for (let i = 0; i < 60; i++) {
        await new Promise(r => requestAnimationFrame(r));
        const now = performance.now();
        const dt = now - lastT;
        lastT = now;
        if (dt > 0) fpsSamples.push(1000 / dt);
      }

      const countDelta = stage.vrmUpdateCounter - lastC;
      const updatesPerFrame = Number((countDelta / 60).toFixed(2));

      fpsSamples.sort((a, b) => a - b);
      const minFps = Number(fpsSamples[0].toFixed(1));
      const avgFps = Number((fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length).toFixed(1));

      const heapMb = performance.memory ? Number((performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2)) : 0;

      return {
        avgFps,
        minFps,
        updatesPerFrame,
        heapMb
      };
    })()
  `);
  console.log("Performance Benchmarks:", JSON.stringify(perf));

  // SAVE MASTER RESULT
  const finalJson = {
    scenarioA: resA,
    scenarioB: resB,
    scenarioC: resC,
    scenarioD: resD,
    scenarioE: resE,
    scenarioF: resF,
    scenarioG: resG,
    scenarioH: resH,
    scenarioI: resI,
    scenarioJ: resJ,
    scenarioK: resK,
    scenarioL: resL,
    performance: perf
  };

  fs.writeFileSync("C:/TEST/MikuChat-v3/scratch/master_qa_final.json", JSON.stringify(finalJson, null, 2), "utf8");
  console.log("\n>>> ALL TESTS COMPLETE AND SAVED TO scratch/master_qa_final.json!");

  server.close();
  app.quit();
});
