import { app, BrowserWindow } from "electron";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

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

server.listen(8770, "127.0.0.1", async () => {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: {
      preload: preloadJs,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  await win.loadURL("http://127.0.0.1:8770/index.html");
  await new Promise((r) => setTimeout(r, 2500));

  const report = await win.webContents.executeJavaScript(`
    (async () => {
      const vrm = window.stage?.vrm;
      if (!vrm) return { error: "vrm not found" };

      const clips = [
        { name: "nod.vrma", path: "./vrma/nod.vrma" },
        { name: "wave.vrma", path: "./vrma/wave.vrma" },
        { name: "explain.vrma", path: "./vrma/explain.vrma" },
        { name: "laugh.vrma", path: "./vrma/laugh.vrma" },
        { name: "think.vrma", path: "./vrma/think.vrma" }
      ];

      const out = [];

      for (const item of clips) {
        // Fetch raw GLB json
        const res = await fetch(item.path);
        const buf = await res.arrayBuffer();
        const view = new DataView(buf);
        const jsonLen = view.getUint32(12, true);
        const jsonBytes = new Uint8Array(buf, 20, jsonLen);
        const jsonStr = new TextDecoder().decode(jsonBytes);
        const gltf = JSON.parse(jsonStr);

        const anim = gltf.animations[0];
        const humanBones = gltf.extensions?.VRMC_vrm_animation?.humanoid?.humanBones || {};
        
        let maxTime = 0;
        let totalKeys = 0;
        for (const s of anim.samplers) {
          const acc = gltf.accessors[s.input];
          if (acc) {
            totalKeys += acc.count;
            if (acc.max && acc.max[0] > maxTime) maxTime = acc.max[0];
          }
        }

        // Hips translation
        const hipsNode = humanBones.hips?.node;
        let hipsTrack = null;
        let hipsDelta = [0, 0, 0];
        for (const ch of anim.channels) {
          if (ch.target.node === hipsNode && ch.target.path === "translation") {
            const acc = gltf.accessors[anim.samplers[ch.sampler].output];
            hipsTrack = acc;
            if (acc.min && acc.max) {
              hipsDelta = [
                Number((acc.max[0] - acc.min[0]).toFixed(3)),
                Number((acc.max[1] - acc.min[1]).toFixed(3)),
                Number((acc.max[2] - acc.min[2]).toFixed(3))
              ];
            }
          }
        }

        out.push({
          file: item.name,
          durationSec: Number(maxTime.toFixed(3)),
          totalKeyframes: totalKeys,
          hasHipsPos: !!hipsTrack,
          hipsDelta
        });
      }

      return out;
    })()
  `);

  console.log("=== RAW_METRICS ===");
  console.log(JSON.stringify(report, null, 2));

  server.close();
  app.quit();
});
