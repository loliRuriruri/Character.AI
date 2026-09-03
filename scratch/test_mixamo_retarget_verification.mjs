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
    res.end("Not Found: " + reqPath);
  }
});

server.listen(8771, "127.0.0.1", async () => {
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

  const logs = [];
  win.webContents.on("console-message", (event, level, message) => {
    logs.push(message);
    if (
      message.includes("[loadMixamoAnimation]") ||
      message.includes("[MotionDirector]") ||
      message.includes("[VRM]") ||
      message.includes("[VERIFY]")
    ) {
      console.log("[ELECTRON_LOG]:", message);
    }
  });

  console.log("Loading http://127.0.0.1:8771/index.html");
  await win.loadURL("http://127.0.0.1:8771/index.html");

  // Wait 4 seconds for VRM model & Mixamo FBX retargeting
  await new Promise((r) => setTimeout(r, 4000));

  console.log("\n=== 1. VERIFYING RETARGETED CLIPS & TRACK FILTERING ===");
  const clipStats = await win.webContents.executeJavaScript(`
    (() => {
      const motion = window.stage?.motion;
      if (!motion) return { error: "motion not found" };

      const gestures = ["nod", "wave", "explain", "laugh", "think"];
      const stats = [];

      for (const g of gestures) {
        const clip = motion.gestureClips.get(g);
        if (!clip) {
          stats.push({ name: g, loaded: false });
          continue;
        }

        const hipsPosTracks = clip.tracks.filter(t => t.name.includes("hips.position"));
        const lookAtTracks = clip.tracks.filter(t => t.name.includes("VRMLookAt") || t.name.includes("lookAt"));
        const expTracks = clip.tracks.filter(t => t.name.includes("expression") || t.name.includes("blendShape"));

        stats.push({
          name: g,
          duration: Number(clip.duration.toFixed(3)),
          totalTracks: clip.tracks.length,
          hasHipsPosition: hipsPosTracks.length > 0,
          hasLookAtTracks: lookAtTracks.length > 0,
          hasExpressionTracks: expTracks.length > 0,
        });
      }

      return stats;
    })()
  `);
  console.log(JSON.stringify(clipStats, null, 2));

  console.log("\n=== 2. SAMPLING KINEMATICS & CHECKING INVERSION (wave & think) ===");
  // Test playing 'wave'
  await win.webContents.executeJavaScript(`
    window.stage?.motion?.play("wave", true);
  `);
  await new Promise((r) => setTimeout(r, 800));

  const waveKinematics = await win.webContents.executeJavaScript(`
    (() => {
      const vrm = window.stage?.vrm;
      const rightHand = vrm?.humanoid?.getNormalizedBoneNode("rightHand");
      const leftHand = vrm?.humanoid?.getNormalizedBoneNode("leftHand");
      const head = vrm?.humanoid?.getNormalizedBoneNode("head");
      const hips = vrm?.humanoid?.getNormalizedBoneNode("hips");

      return {
        gesture: "wave",
        rightHandPos: rightHand ? [rightHand.position.x.toFixed(3), rightHand.position.y.toFixed(3), rightHand.position.z.toFixed(3)] : null,
        leftHandPos: leftHand ? [leftHand.position.x.toFixed(3), leftHand.position.y.toFixed(3), leftHand.position.z.toFixed(3)] : null,
        headRot: head ? [head.rotation.x.toFixed(3), head.rotation.y.toFixed(3), head.rotation.z.toFixed(3)] : null,
        hipsPos: hips ? [hips.position.x.toFixed(3), hips.position.y.toFixed(3), hips.position.z.toFixed(3)] : null,
      };
    })()
  `);
  console.log("Wave Kinematics (check rightHand raised):", waveKinematics);

  // Test playing 'think'
  await win.webContents.executeJavaScript(`
    window.stage?.motion?.play("think", true);
  `);
  await new Promise((r) => setTimeout(r, 800));

  const thinkKinematics = await win.webContents.executeJavaScript(`
    (() => {
      const vrm = window.stage?.vrm;
      const rightHand = vrm?.humanoid?.getNormalizedBoneNode("rightHand");
      const leftHand = vrm?.humanoid?.getNormalizedBoneNode("leftHand");
      const head = vrm?.humanoid?.getNormalizedBoneNode("head");
      const hips = vrm?.humanoid?.getNormalizedBoneNode("hips");

      return {
        gesture: "think",
        rightHandPos: rightHand ? [rightHand.position.x.toFixed(3), rightHand.position.y.toFixed(3), rightHand.position.z.toFixed(3)] : null,
        leftHandPos: leftHand ? [leftHand.position.x.toFixed(3), leftHand.position.y.toFixed(3), leftHand.position.z.toFixed(3)] : null,
        headRot: head ? [head.rotation.x.toFixed(3), head.rotation.y.toFixed(3), head.rotation.z.toFixed(3)] : null,
        hipsPos: hips ? [hips.position.x.toFixed(3), hips.position.y.toFixed(3), hips.position.z.toFixed(3)] : null,
      };
    })()
  `);
  console.log("Think Kinematics (check hand near chin):", thinkKinematics);

  // Test playing 'nod'
  await win.webContents.executeJavaScript(`
    window.stage?.motion?.play("nod", true);
  `);
  await new Promise((r) => setTimeout(r, 600));

  const nodKinematics = await win.webContents.executeJavaScript(`
    (() => {
      const vrm = window.stage?.vrm;
      const head = vrm?.humanoid?.getNormalizedBoneNode("head");
      const hips = vrm?.humanoid?.getNormalizedBoneNode("hips");

      return {
        gesture: "nod",
        headRot: head ? [head.rotation.x.toFixed(3), head.rotation.y.toFixed(3), head.rotation.z.toFixed(3)] : null,
        hipsPos: hips ? [hips.position.x.toFixed(3), hips.position.y.toFixed(3), hips.position.z.toFixed(3)] : null,
      };
    })()
  `);
  console.log("Nod Kinematics (check head pitch forward):", nodKinematics);

  // Wait 2.5s for gesture to finish and crossFade to idle
  await new Promise((r) => setTimeout(r, 2500));

  console.log("\n=== 3. CHECKING IDLE RESTORATION & T-POSE POP ===");
  const idleStatus = await win.webContents.executeJavaScript(`
    (() => {
      const hud = document.getElementById("motion-debug-hud");
      const vrm = window.stage?.vrm;
      const hips = vrm?.humanoid?.getNormalizedBoneNode("hips");
      const arm = vrm?.humanoid?.getNormalizedBoneNode("leftUpperArm");

      return {
        hudText: hud ? hud.innerText : "",
        hipsPos: hips ? [hips.position.x.toFixed(3), hips.position.y.toFixed(3), hips.position.z.toFixed(3)] : null,
        armRotZ: arm ? arm.rotation.z.toFixed(3) : null
      };
    })()
  `);
  console.log("Idle Status (check armRotZ != 0):", idleStatus);

  server.close();
  app.quit();
});
