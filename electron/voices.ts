import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TtsVoice, VoiceCatalog, VoiceReferenceAsset } from "../src/shared/types";

const here = path.dirname(fileURLToPath(import.meta.url));

function exists(p: string): boolean {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

export function projectRoot(): string {
  const candidates = [
    path.join(here, ".."),
    process.cwd(),
    "C:\\TEST\\MikuChat-v2",
  ];
  const hit = candidates.find((c) => exists(path.join(c, "assets", "tts")));
  return hit || candidates[0];
}

export function catalogPath(): string {
  return path.join(projectRoot(), "assets", "tts", "voices.json");
}

export function loadVoiceCatalog(): VoiceCatalog {
  const p = catalogPath();
  if (!exists(p)) return { defaultId: "my_voice_03", voices: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<VoiceCatalog>;
    const voices = Array.isArray(raw.voices) ? raw.voices.filter((v) => v && v.id && v.wav) : [];
    return {
      defaultId: raw.defaultId || "my_voice_03",
      notes: raw.notes,
      voices,
    };
  } catch {
    return { defaultId: "my_voice_03", voices: [] };
  }
}

export function resolveVoiceWav(wavOrId: string): string {
  const trimmed = (wavOrId || "").trim();
  if (!trimmed) return trimmed;

  // 1. If absolute path and exists
  if (path.isAbsolute(trimmed) && exists(trimmed)) return trimmed;

  // 2. If it's a voice ID in the catalog
  const catalogVoice = voiceById(trimmed);
  if (catalogVoice && catalogVoice.wav) {
    const fromCat = path.isAbsolute(catalogVoice.wav)
      ? catalogVoice.wav
      : path.join(projectRoot(), catalogVoice.wav);
    if (exists(fromCat)) return fromCat;
  }

  // 3. If it's inside assets/tts/voices/<id>/ref.wav
  const refWav = path.join(projectRoot(), "assets", "tts", "voices", trimmed, "ref.wav");
  if (exists(refWav)) return refWav;

  // 4. If relative path to projectRoot
  const full = path.join(projectRoot(), trimmed);
  if (exists(full)) return full;

  // 5. Fallback: try default catalog voice
  const defaultV = loadVoiceCatalog().voices[0];
  if (defaultV && defaultV.wav) {
    const defWav = path.isAbsolute(defaultV.wav) ? defaultV.wav : path.join(projectRoot(), defaultV.wav);
    if (exists(defWav)) return defWav;
  }

  return full;
}

export function voiceById(id: string): TtsVoice | undefined {
  const wanted = (id || "").trim();
  if (!wanted) return undefined;
  return loadVoiceCatalog().voices.find((v) => v.id === wanted);
}

export function addVoiceToCatalog(newVoice: TtsVoice): void {
  const p = catalogPath();
  const catalog = loadVoiceCatalog();
  const existingIndex = catalog.voices.findIndex((v) => v.id === newVoice.id);
  if (existingIndex >= 0) {
    catalog.voices[existingIndex] = newVoice;
  } else {
    catalog.voices.unshift(newVoice);
  }
  fs.writeFileSync(p, JSON.stringify(catalog, null, 2), "utf8");
}

export function applyVoiceSelection(id: string): {
  ttsVoiceId: string;
  voxcpmReferenceWav: string;
  voxcpmPromptText: string;
  qwen3ReferenceWav: string;
  qwen3PromptText: string;
} | null {
  const v = voiceById(id);
  if (!v) return null;
  const resolved = resolveVoiceWav(v.wav);
  const prompt = (v.promptText || "").trim();
  return {
    ttsVoiceId: v.id,
    voxcpmReferenceWav: resolved,
    voxcpmPromptText: prompt,
    qwen3ReferenceWav: resolved,
    qwen3PromptText: prompt,
  };
}

export function toVoiceReferenceAsset(v: TtsVoice): VoiceReferenceAsset {
  return {
    id: v.id,
    displayName: v.displayName,
    language: "auto",
    audioPath: resolveVoiceWav(v.wav),
    transcript: v.promptText,
    durationSec: v.durationSec,
    sampleRate: 48000,
    source: "imported",
    rightsConfirmed: true,
  };
}

export function getVoiceReferenceAsset(idOrPath: string): VoiceReferenceAsset {
  const v = voiceById(idOrPath);
  if (v) return toVoiceReferenceAsset(v);
  const resolved = resolveVoiceWav(idOrPath);
  let transcript = "";
  const sidecar = resolved.replace(/\.wav$/i, ".txt");
  if (fs.existsSync(sidecar)) {
    try { transcript = fs.readFileSync(sidecar, "utf-8").trim(); } catch {}
  }
  return {
    id: path.basename(resolved, path.extname(resolved)),
    displayName: path.basename(resolved),
    language: "auto",
    audioPath: resolved,
    transcript,
    source: "user",
    rightsConfirmed: true,
  };
}

