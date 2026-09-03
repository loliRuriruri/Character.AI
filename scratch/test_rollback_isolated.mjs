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

server.listen(8768, "127.0.0.1", async () => {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 800,
    height: 900,
    show: false,
    webPreferences: {
      preload: preloadJs,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  const errs = [];
  win.webContents.on("console-message", (event, level, message) => {
    if (level === 3) errs.push(message); // level 3 is error
  });

  console.log("Loading http://127.0.0.1:8768/index.html with MOTION_V2 forced false");
  await win.loadURL("http://127.0.0.1:8768/index.html");

  // Force MOTION_V2 to false immediately before model load starts
  await win.webContents.executeJavaScript(`
    window.__MOTION_CONFIG__.MOTION_V2 = false;
  `);

  // Wait 4 seconds for model loading and rendering
  await new Promise((r) => setTimeout(r, 4000));

  // Inspect legacy loop execution
  const res = await win.webContents.executeJavaScript(`
    (() => {
      return {
        motionV2: window.__MOTION_CONFIG__.MOTION_V2,
        errors: window.__lastError || null
      };
    })()
  `);

  console.log("=== ROLLBACK BOOT RESULT ===");
  console.log(JSON.stringify(res, null, 2));
  console.log("Console errors count:", errs.length);

  server.close();
  app.quit();
});
