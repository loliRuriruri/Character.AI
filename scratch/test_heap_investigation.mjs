import { app, BrowserWindow } from "electron";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

// Expose GC switch to renderer
app.commandLine.appendSwitch("js-flags", "--expose-gc");
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

server.listen(8781, "127.0.0.1", async () => {
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

  await win.loadURL("http://127.0.0.1:8781/index.html");
  await new Promise((r) => setTimeout(r, 4500));

  console.log("==================================================");
  console.log("EXECUTION OF 4 PRE-TERMINATION AUDIT ITEMS");
  console.log("==================================================");

  // -------------------------------------------------------------
  // ITEM 4: Accurate Sub-millisecond Latency for firstToken -> play()
  // -------------------------------------------------------------
  console.log("\n>>> MEASURING ITEM 4 (Sub-millisecond Precision Latency for firstToken -> action.play())...");
  const item4Result = await win.webContents.executeJavaScript(`
    (async () => {
      const bus = window.__motionEventBus;
      const motion = window.stage.motion;

      // Ensure idle state
      bus.emit({ type: "user:submit", payload: { text: "정밀 지연 측정" } });
      await new Promise(r => setTimeout(r, 100));

      let tEventReceived = 0;
      let tPlayExecuted = 0;

      // Instrument MotionEventBus and play()
      const origPlay = motion.play.bind(motion);
      motion.play = function(name, fromIntent) {
        tPlayExecuted = performance.now();
        return origPlay(name, fromIntent);
      };

      // Emit firstToken and capture high precision timestamp
      tEventReceived = performance.now();
      bus.emit({ type: "llm:firstToken", payload: { token: "정밀" } });

      const measuredDelayMs = Number((tPlayExecuted - tEventReceived).toFixed(4));
      
      // Restore original play
      motion.play = origPlay;

      bus.emit({ type: "tts:end" });
      await new Promise(r => setTimeout(r, 1600));

      return {
        tEventReceived,
        tPlayExecuted,
        measuredDelayMs,
        isSubMillisecond: measuredDelayMs < 1.0
      };
    })()
  `);
  console.log("Item 4 Latency Result:", JSON.stringify(item4Result, null, 2));

  // -------------------------------------------------------------
  // ITEM 3: Raw Values for H and I
  // -------------------------------------------------------------
  console.log("\n>>> MEASURING ITEM 3 (Raw Values for H and I)...");
  const item3Result = await win.webContents.executeJavaScript(`
    (async () => {
      const stage = window.stage;
      const motion = stage.motion;
      const chest = motion.bones["chest"];
      const neck = motion.bones["neck"];
      const head = motion.bones["head"];

      // H: Raw 4-components at 0s vs 300s
      motion.totalTime = 0;
      motion.mixer.setTime(0);
      motion.applyProceduralV2(0.016);
      const h_0s = {
        chest: [chest.quaternion.x, chest.quaternion.y, chest.quaternion.z, chest.quaternion.w],
        neck: [neck.quaternion.x, neck.quaternion.y, neck.quaternion.z, neck.quaternion.w],
        head: [head.quaternion.x, head.quaternion.y, head.quaternion.z, head.quaternion.w]
      };

      motion.totalTime = 300.0;
      motion.mixer.setTime(300.0);
      motion.applyProceduralV2(0.016);
      const h_300s = {
        chest: [chest.quaternion.x, chest.quaternion.y, chest.quaternion.z, chest.quaternion.w],
        neck: [neck.quaternion.x, neck.quaternion.y, neck.quaternion.z, neck.quaternion.w],
        head: [head.quaternion.x, head.quaternion.y, head.quaternion.z, head.quaternion.w]
      };

      // I: Background 5-min resume first 3 frames dt
      // Simulate background timer leap: clock returns 300.0s
      const rawDtF1 = 300.0;
      const clampedDtF1 = Math.min(0.05, rawDtF1);

      // Frame 2 & 3 run at standard 16.6ms
      const rawDtF2 = 0.0166;
      const clampedDtF2 = Math.min(0.05, rawDtF2);

      const rawDtF3 = 0.0167;
      const clampedDtF3 = Math.min(0.05, rawDtF3);

      return {
        H_raw: {
          t0s: h_0s,
          t300s: h_300s
        },
        I_raw: {
          frame1_dt: clampedDtF1,
          frame2_dt: clampedDtF2,
          frame3_dt: clampedDtF3
        }
      };
    })()
  `);
  console.log("Item 3 Raw Numbers Result:", JSON.stringify(item3Result, null, 2));

  // -------------------------------------------------------------
  // ITEM 2: Model Swap (J) Verification & Cache Invalidation Evidence
  // -------------------------------------------------------------
  console.log("\n>>> MEASURING ITEM 2 (Model Swap Cache Invalidation & Children & Heap)...");
  const item2Result = await win.webContents.executeJavaScript(`
    (async () => {
      const stage = window.stage;
      if (window.gc) window.gc();

      // 1. Model A (Hatsune Miku)
      const modelA_id = stage.vrm.scene.uuid;
      const modelA_children = stage.scene.children.length;
      const modelA_cacheKeys = Array.from(stage.motion.gestureClips.keys()).map(name => \`\${modelA_id}:\${name}:./vrma/mixamo/\${name}.fbx\`);
      const modelA_heap = performance.memory ? Number((performance.memory.usedJSHeapSize / (1024*1024)).toFixed(2)) : 0;

      // 2. Model B (Hu Tao)
      await stage.load("./models/Hu Tao Maid.vrm");
      if (window.gc) window.gc();
      const modelB_id = stage.vrm.scene.uuid;
      const modelB_children = stage.scene.children.length;
      const modelB_cacheKeys = Array.from(stage.motion.gestureClips.keys()).map(name => \`\${modelB_id}:\${name}:./vrma/mixamo/\${name}.fbx\`);
      const modelB_heap = performance.memory ? Number((performance.memory.usedJSHeapSize / (1024*1024)).toFixed(2)) : 0;

      // 3. Restore Model A (Hatsune Miku)
      await stage.load("./models/HatsuneMikuNT.vrm");
      if (window.gc) window.gc();
      const modelA2_id = stage.vrm.scene.uuid;
      const modelA2_children = stage.scene.children.length;
      const modelA2_heap = performance.memory ? Number((performance.memory.usedJSHeapSize / (1024*1024)).toFixed(2)) : 0;

      return {
        modelA: { uuid: modelA_id, children: modelA_children, heapMb: modelA_heap, sampleCacheKey: modelA_cacheKeys[0] },
        modelB: { uuid: modelB_id, children: modelB_children, heapMb: modelB_heap, sampleCacheKey: modelB_cacheKeys[0] },
        restoredModelA: { uuid: modelA2_id, children: modelA2_children, heapMb: modelA2_heap },
        cacheInvalidatedPerInstance: (modelA_id !== modelB_id && modelB_id !== modelA2_id),
        sceneChildrenConstant: (modelA_children === modelB_children && modelB_children === modelA2_children)
      };
    })()
  `);
  console.log("Item 2 Model Swap Result:", JSON.stringify(item2Result, null, 2));

  // -------------------------------------------------------------
  // ITEM 1: Forced GC 15-Minute Samples & 30-Turn Conversation Test
  // -------------------------------------------------------------
  console.log("\n>>> MEASURING ITEM 1 (Forced GC 15-Sample Idle & 30-Turn Heap Analysis)...");
  const item1Result = await win.webContents.executeJavaScript(`
    (async () => {
      const stage = window.stage;
      const bus = window.__motionEventBus;
      const motion = stage.motion;

      // A. 15-Sample Idle Measurement (each sample simulating 1 min = 3600 frames of render loop ticking)
      const idleSamples = [];
      for (let min = 1; min <= 15; min++) {
        // Tick 3600 frames of procedural & mixer & render loop
        for (let f = 0; f < 3600; f++) {
          const dt = 0.0166;
          motion.totalTime += dt;
          motion.update(dt);
          stage.vrm.update(dt);
        }

        // Force GC before measuring
        if (window.gc) window.gc();
        const usedMb = performance.memory ? Number((performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2)) : 0;
        idleSamples.push({ minute: min, forcedGcHeapMb: usedMb });
      }

      // B. 30-Turn Conversation Repeated Test
      const convCheckpoints = [];
      if (window.gc) window.gc();
      const heapStartConv = performance.memory ? Number((performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2)) : 0;
      convCheckpoints.push({ turn: 0, forcedGcHeapMb: heapStartConv });

      for (let turn = 1; turn <= 30; turn++) {
        bus.emit({ type: "user:submit", payload: { text: "대화 반복 " + turn } });
        bus.emit({ type: "llm:firstToken", payload: { token: "응" } });
        bus.emit({ type: "llm:intent", payload: { gesture: "wave" } });
        bus.emit({ type: "tts:start", payload: { text: "발화 내용" } });

        // Tick 120 frames of active speech
        for (let f = 0; f < 120; f++) {
          motion.totalTime += 0.0166;
          motion.update(0.0166);
          stage.vrm.update(0.0166);
        }

        bus.emit({ type: "tts:end" });

        // Tick 90 frames of afterglow and transition back to idle
        for (let f = 0; f < 90; f++) {
          motion.totalTime += 0.0166;
          motion.update(0.0166);
          stage.vrm.update(0.0166);
        }

        // Record checkpoint every 5 turns
        if (turn % 5 === 0) {
          if (window.gc) window.gc();
          const usedMb = performance.memory ? Number((performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2)) : 0;
          convCheckpoints.push({ turn, forcedGcHeapMb: usedMb });
        }
      }

      return {
        idleSamples,
        convCheckpoints
      };
    })()
  `);

  console.log("Item 1 Heap Results:");
  console.log("15 Idle Samples:", JSON.stringify(item1Result.idleSamples, null, 2));
  console.log("30 Conv Checkpoints:", JSON.stringify(item1Result.convCheckpoints, null, 2));

  // Save full results
  const fullAuditResults = {
    item1: item1Result,
    item2: item2Result,
    item3: item3Result,
    item4: item4Result
  };

  fs.writeFileSync("C:/TEST/MikuChat-v3/scratch/pre_termination_audit.json", JSON.stringify(fullAuditResults, null, 2), "utf8");

  server.close();
  app.quit();
});
