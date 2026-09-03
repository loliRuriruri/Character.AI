import { defineConfig } from "vite";
import electron from "vite-plugin-electron/simple";
import path from "node:path";

export default defineConfig({
  base: "./",
  publicDir: "public",
  build: {
    rollupOptions: {
      input: {
        character: path.resolve(__dirname, "index.html"),
        overlay: path.resolve(__dirname, "overlay.html"),
        settings: path.resolve(__dirname, "settings.html"),
        rigtest: path.resolve(__dirname, "rigtest.html"),
      },
    },
  },
  plugins: [
    electron({
      main: { entry: "electron/main.ts" },
      preload: { input: "electron/preload.ts" },
    }),
  ],
});

