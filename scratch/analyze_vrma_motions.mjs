import { app, BrowserWindow } from "electron";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const distDir = "C:/TEST/MikuChat-v3/dist";
const preloadJs = "C:/TEST/MikuChat-v3/dist-electron/preload.mjs";

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split("?")[0]);
  if (reqPath === "/") reqPath = "/rigtest.html";
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

server.listen(8769, "127.0.0.1", async () => {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    show: true,
    webPreferences: {
      preload: preloadJs,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  await win.loadURL("http://127.0.0.1:8769/rigtest.html");
  await new Promise((r) => setTimeout(r, 2000));

  // Script to inspect each VRMA 01 to 07
  const vrmaList = [
    { name: "nod.vrma (VRMA_02)", path: "./vrma/VRMA_02.vrma" },
    { name: "wave.vrma (VRMA_01)", path: "./vrma/VRMA_01.vrma" },
    { name: "explain.vrma (VRMA_05)", path: "./vrma/VRMA_05.vrma" },
    { name: "laugh.vrma (VRMA_03)", path: "./vrma/VRMA_03.vrma" },
    { name: "think.vrma (VRMA_04)", path: "./vrma/VRMA_04.vrma" },
    { name: "VRMA_06.vrma", path: "./vrma/VRMA_06.vrma" },
    { name: "VRMA_07.vrma", path: "./vrma/VRMA_07.vrma" },
  ];

  const results = [];

  for (const item of vrmaList) {
    const analysis = await win.webContents.executeJavaScript(`
      (async () => {
        // Load VRMA through loader
        const vrmaGltf = await window.loader.loadAsync("${item.path}");
        const vrmAnimation = (vrmaGltf.userData.vrmAnimations ?? [vrmaGltf.userData.vrmAnimation])[0];
        const clip = window.createVRMAnimationClip(vrmAnimation, window.currentVrm);

        // Analyze tracks
        const tracks = clip.tracks.map(t => t.name);
        const hipsPosTrack = clip.tracks.find(t => t.name.includes("hips.position"));
        
        let hipsDisplacement = 0;
        let hipsMaxDelta = [0, 0, 0];
        if (hipsPosTrack) {
          const values = hipsPosTrack.values;
          let minX = values[0], maxX = values[0];
          let minY = values[1], maxY = values[1];
          let minZ = values[2], maxZ = values[2];
          for (let i = 0; i < values.length; i += 3) {
            minX = Math.min(minX, values[i]); maxX = Math.max(maxX, values[i]);
            minY = Math.min(minY, values[i+1]); maxY = Math.max(maxY, values[i+1]);
            minZ = Math.min(minZ, values[i+2]); maxZ = Math.max(maxZ, values[i+2]);
          }
          hipsMaxDelta = [(maxX - minX).toFixed(3), (maxY - minY).toFixed(3), (maxZ - minZ).toFixed(3)];
          hipsDisplacement = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ).toFixed(3);
        }

        // Sample poses at t=0, t=25%, t=50%, t=75%, t=100%
        const humanoid = window.currentVrm.humanoid;
        const mixer = new window.THREE.AnimationMixer(window.currentVrm.scene);
        const action = mixer.clipAction(clip);
        action.play();

        const samples = [];
        const times = [0, clip.duration * 0.25, clip.duration * 0.5, clip.duration * 0.75, clip.duration];
        for (const tm of times) {
          mixer.setTime(tm);
          window.currentVrm.update(0.016);
          const headNode = humanoid.getNormalizedBoneNode("head");
          const leftHand = humanoid.getNormalizedBoneNode("leftHand");
          const rightHand = humanoid.getNormalizedBoneNode("rightHand");
          const hips = humanoid.getNormalizedBoneNode("hips");
          
          samples.push({
            time: tm.toFixed(1),
            headRot: headNode ? [headNode.rotation.x.toFixed(2), headNode.rotation.y.toFixed(2), headNode.rotation.z.toFixed(2)] : null,
            rightHandPos: rightHand ? [rightHand.position.x.toFixed(2), rightHand.position.y.toFixed(2), rightHand.position.z.toFixed(2)] : null,
            leftHandPos: leftHand ? [leftHand.position.x.toFixed(2), leftHand.position.y.toFixed(2), leftHand.position.z.toFixed(2)] : null,
            hipsPos: hips ? [hips.position.x.toFixed(2), hips.position.y.toFixed(2), hips.position.z.toFixed(2)] : null
          });
        }

        action.stop();
        mixer.uncacheClip(clip);

        return {
          duration: clip.duration.toFixed(2),
          tracksCount: clip.tracks.length,
          hasHipsPos: !!hipsPosTrack,
          hipsDisplacement,
          hipsMaxDelta,
          samples
        };
      })()
    `);

    results.push({ item: item.name, analysis });
  }

  console.log("=== MOTION_ANALYSIS_RESULTS ===");
  console.log(JSON.stringify(results, null, 2));

  server.close();
  app.quit();
});
