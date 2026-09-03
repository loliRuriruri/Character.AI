import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { defaultSettings, type AppSettings } from "../src/shared/types";

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function withDetectedDefaults(): AppSettings {
  const base: AppSettings = { ...defaultSettings };
  if (!fs.existsSync(base.voxcpmPythonPath)) {
    base.ttsProvider = "web";
  }
  return base;
}

export function loadSettings(): AppSettings {
  const base = withDetectedDefaults();
  try {
    const raw = fs.readFileSync(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...base, ...parsed };
  } catch {
    return base;
  }
}

export function saveSettings(next: AppSettings): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf8");
}
