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

server.listen(8774, "127.0.0.1", async () => {
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

  win.webContents.on("console-message", (ev, lvl, msg) => {
    if (lvl >= 2) console.log("[BROWSER_ERR]:", msg);
  });

  await win.loadURL("http://127.0.0.1:8774/index.html");
  await new Promise((r) => setTimeout(r, 4000));

  // 1. Sample Wave
  await win.webContents.executeJavaScript(`
    window.stage?.motion?.play("wave", true);
  `);
  await new Promise((r) => setTimeout(r, 1000));

  const waveWorld = await win.webContents.executeJavaScript(`
    (() => {
      const vrm = window.stage?.vrm;
      const rHand = vrm?.humanoid?.getNormalizedBoneNode("rightHand");
      const lHand = vrm?.humanoid?.getNormalizedBoneNode("leftHand");
      const head = vrm?.humanoid?.getNormalizedBoneNode("head");
      const hips = vrm?.humanoid?.getNormalizedBoneNode("hips");

      const rX = rHand?.matrixWorld.elements[12] ?? 0;
      const rY = rHand?.matrixWorld.elements[13] ?? 0;
      const rZ = rHand?.matrixWorld.elements[14] ?? 0;

      const lX = lHand?.matrixWorld.elements[12] ?? 0;
      const lY = lHand?.matrixWorld.elements[13] ?? 0;
      const lZ = lHand?.matrixWorld.elements[14] ?? 0;

      const hX = head?.matrixWorld.elements[12] ?? 0;
      const hY = head?.matrixWorld.elements[13] ?? 0;
      const hZ = head?.matrixWorld.elements[14] ?? 0;

      const hipY = hips?.matrixWorld.elements[13] ?? 0;

      return {
        rHand: [rX.toFixed(3), rY.toFixed(3), rZ.toFixed(3)],
        lHand: [lX.toFixed(3), lY.toFixed(3), lZ.toFixed(3)],
        head: [hX.toFixed(3), hY.toFixed(3), hZ.toFixed(3)],
        rightHandIsWavingUp: rY > hipY + 0.3,
        leftHandIsDown: lY < hipY + 0.1
      };
    })()
  `);
  console.log("=== WAVE WORLD KINEMATICS ===");
  console.log(JSON.stringify(waveWorld, null, 2));

  // 2. Sample Think
  await win.webContents.executeJavaScript(`
    window.stage?.motion?.play("think", true);
  `);
  await new Promise((r) => setTimeout(r, 1200));

  const thinkWorld = await win.webContents.executeJavaScript(`
    (() => {
      const vrm = window.stage?.vrm;
      const rHand = vrm?.humanoid?.getNormalizedBoneNode("rightHand");
      const head = vrm?.humanoid?.getNormalizedBoneNode("head");

      const rX = rHand?.matrixWorld.elements[12] ?? 0;
      const rY = rHand?.matrixWorld.elements[13] ?? 0;
      const rZ = rHand?.matrixWorld.elements[14] ?? 0;

      const hX = head?.matrixWorld.elements[12] ?? 0;
      const hY = head?.matrixWorld.elements[13] ?? 0;
      const hZ = head?.matrixWorld.elements[14] ?? 0;

      const dist = Math.hypot(rX - hX, rY - hY, rZ - hZ);

      return {
        rHand: [rX.toFixed(3), rY.toFixed(3), rZ.toFixed(3)],
        head: [hX.toFixed(3), hY.toFixed(3), hZ.toFixed(3)],
        distHandToHead: dist.toFixed(3),
        handInFrontOfFace: rZ > (hZ - 0.1) // hand in front of face
      };
    })()
  `);
  console.log("=== THINK WORLD KINEMATICS ===");
  console.log(JSON.stringify(thinkWorld, null, 2));

  // 3. Sample Nod
  await win.webContents.executeJavaScript(`
    window.stage?.motion?.play("nod", true);
  `);
  await new Promise((r) => setTimeout(r, 800));

  const nodWorld = await win.webContents.executeJavaScript(`
    (() => {
      const vrm = window.stage?.vrm;
      const head = vrm?.humanoid?.getNormalizedBoneNode("head");
      return {
        headRotX: head ? head.rotation.x.toFixed(3) : null,
        isNoddingDown: head ? head.rotation.x > 0.05 : false
      };
    })()
  `);
  console.log("=== NOD WORLD KINEMATICS ===");
  console.log(JSON.stringify(nodWorld, null, 2));

  // 4. Sample Explain
  await win.webContents.executeJavaScript(`
    window.stage?.motion?.play("explain", true);
  `);
  await new Promise((r) => setTimeout(r, 1000));

  const explainWorld = await win.webContents.executeJavaScript(`
    (() => {
      const vrm = window.stage?.vrm;
      const rHand = vrm?.humanoid?.getNormalizedBoneNode("rightHand");
      const lHand = vrm?.humanoid?.getNormalizedBoneNode("leftHand");
      const hips = vrm?.humanoid?.getNormalizedBoneNode("hips");

      const rZ = rHand?.matrixWorld.elements[14] ?? 0;
      const lZ = lHand?.matrixWorld.elements[14] ?? 0;
      const hipZ = hips?.matrixWorld.elements[14] ?? 0;

      return {
        handsProjectedForward: (rZ > hipZ) && (lZ > hipZ)
      };
    })()
  `);
  console.log("=== EXPLAIN WORLD KINEMATICS ===");
  console.log(JSON.stringify(explainWorld, null, 2));

  // 5. Sample Laugh
  await win.webContents.executeJavaScript(`
    window.stage?.motion?.play("laugh", true);
  `);
  await new Promise((r) => setTimeout(r, 1000));

  const laughWorld = await win.webContents.executeJavaScript(`
    (() => {
      const vrm = window.stage?.vrm;
      const rHand = vrm?.humanoid?.getNormalizedBoneNode("rightHand");
      const hips = vrm?.humanoid?.getNormalizedBoneNode("hips");

      const rY = rHand?.matrixWorld.elements[13] ?? 0;
      const hipY = hips?.matrixWorld.elements[13] ?? 0;

      return {
        handNearChest: (rY > hipY + 0.15)
      };
    })()
  `);
  console.log("=== LAUGH WORLD KINEMATICS ===");
  console.log(JSON.stringify(laughWorld, null, 2));

  server.close();
  app.quit();
});
