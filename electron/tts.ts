import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppSettings, TtsStatus, CharacterVoiceProfile, TtsProvider } from "../src/shared/types";
import { sanitizeSpeechForTts } from "../src/core/response/TtsSanitizer";
import { resolveVoiceWav } from "./voices";

const here = path.dirname(fileURLToPath(import.meta.url));

export type TtsPlay =
  | { kind: "wav"; b64: string; text: string; duration: number }
  | { kind: "web"; text: string; fallback: boolean; reason?: string }
  | { kind: "viseme"; text: string; duration: number }
  | { kind: "none" };

type Pending = {
  id: string;
  resolve: (v: { output: string; duration: number }) => void;
  reject: (e: Error) => void;
};

function exists(p: string): boolean {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

export function resolveWorkerScript(): string {
  const candidates = [
    path.join(here, "../scripts/voxcpm_worker.py"),
    path.join(process.cwd(), "scripts/voxcpm_worker.py"),
    "C:\\TEST\\MikuChat-v2\\scripts\\voxcpm_worker.py",
  ];
  const hit = candidates.find(exists);
  if (!hit) throw new Error("voxcpm_worker.py 를 찾을 수 없습니다: " + candidates.join(" | "));
  return hit;
}

export function toWindowlessPython(pythonPath: string): string {
  if (process.platform === "win32" && pythonPath) {
    const pw = pythonPath.replace(/python\.exe$/i, "pythonw.exe");
    if (fs.existsSync(pw)) return pw;
  }
  return pythonPath;
}

export function venvLooksPresent(pythonPath: string): boolean {
  return exists(pythonPath);
}

export class VoxcpmTts {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ready = false;
  private starting: Promise<void> | null = null;
  private buf = "";
  private seq = 0;
  private generation = 0;
  private pending = new Map<string, Pending>();
  private stderrTail: string[] = [];
  private startedWith = "";

  constructor(
    private readonly onStatus: (s: TtsStatus) => void,
  ) {}

  
  async prewarm(settings: AppSettings): Promise<void> {
    if (settings.ttsProvider === "voxcpm" && settings.ttsEnabled) {
      await this.ensureWorker(settings).catch((err) => console.warn("TTS prewarm skipped:", err));
    }
  }

  stopWorker(): void {
    this.rejectAll(new Error("VoxCPM worker stopped"));
    this.ready = false;
    this.starting = null;
    this.startedWith = "";
    if (this.proc && !this.proc.killed) {
      try { this.proc.stdin.end(); } catch { /* ignore */ }
      try { this.proc.kill(); } catch { /* ignore */ }
    }
    this.proc = null;
  }

  async speak(settings: AppSettings, text: string): Promise<TtsPlay> {
    const spoken = text.trim();
    if (!spoken) return { kind: "none" };
    if (!settings.ttsEnabled) {
      return { kind: "viseme", text: spoken, duration: Math.max(0.8, spoken.length * 0.08) };
    }
    if (settings.ttsProvider !== "voxcpm") {
      return { kind: "web", text: spoken, fallback: false };
    }
    const gen = ++this.generation;
    try {
      await this.ensureWorker(settings);
      if (gen !== this.generation) return { kind: "none" };
      this.onStatus("synthesizing");
      if (gen !== this.generation) return { kind: "none" };
      const outPath = path.join(os.tmpdir(), `mikuchat-tts-${Date.now()}-${gen}.wav`);
      const result = await this.requestSynth(spoken, outPath, settings);
      if (gen !== this.generation) return { kind: "none" };
      const buf = fs.readFileSync(result.output);
      if (buf.length < 44) throw new Error("합성 wav 가 너무 작습니다");
      try { fs.unlinkSync(result.output); } catch { /* ignore */ }
      return {
        kind: "wav",
        b64: buf.toString("base64"),
        text: spoken,
        duration: result.duration,
      };
    } catch (err) {
      if (gen !== this.generation) return { kind: "none" };
      const reason = err instanceof Error ? err.message : String(err);
      if (settings.ttsWebFallback) {
        return { kind: "web", text: spoken, fallback: true, reason };
      }
      throw new Error(reason);
    }
  }

  cancelPending(): void {
    this.generation += 1;
    this.rejectAll(new Error("cancelled"));
  }

  private resolvedRef(settings: AppSettings): string {
    return resolveVoiceWav(settings.voxcpmReferenceWav.trim());
  }

  private fingerprint(settings: AppSettings): string {
    // Dynamic zero-shot switching: reference wav and prompt text are passed dynamically per-request.
    // Only restart worker if python path or compute device changes!
    return [
      settings.voxcpmPythonPath,
      settings.voxcpmDevice || "auto",
    ].join("|");
  }

  private async ensureWorker(settings: AppSettings): Promise<void> {
    const python = settings.voxcpmPythonPath.trim();
    const ref = this.resolvedRef(settings);
    if (!exists(python)) throw new Error("VoxCPM python 경로가 없습니다: " + python);
    if (!exists(ref)) throw new Error("참조 wav 가 없습니다: " + ref);
    const fp = this.fingerprint(settings);
    if (this.proc && this.ready && this.startedWith === fp) return;
    if (this.starting && this.startedWith === fp) return this.starting;
    this.stopWorker();
    this.startedWith = fp;
    this.onStatus("loading");
    this.starting = this.spawnWorker(settings);
    try {
      await this.starting;
      void this.requestSynth("네.", path.join(os.tmpdir(), "miku-warmup.wav")).catch(() => {});
    } finally {
      this.starting = null;
    }
  }

  private spawnWorker(settings: AppSettings): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = resolveWorkerScript();
      const ref = this.resolvedRef(settings);
      const promptFile = sidecarFor(ref);
      const args = [
        "-u",
        worker,
        "--reference-audio", ref,
        "--prompt-audio", ref,
        "--device", settings.voxcpmDevice || "auto",
        "--hf-model-id", "openbmb/VoxCPM2",
        "--inference-timesteps", "6",
        "--cfg-value", "1.5",
      ];
      if (settings.voxcpmPromptText.trim()) {
        args.push("--prompt-text", settings.voxcpmPromptText.trim());
      } else if (exists(promptFile)) {
        args.push("--prompt-file", promptFile);
      }
      const proc = spawn(toWindowlessPython(settings.voxcpmPythonPath), args, {
        env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.proc = proc;
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("VoxCPM 모델 로딩 시간 초과 (4분). GPU/가중치 상태를 확인하세요."));
          this.stopWorker();
        }
      }, 240000);

      const finishOk = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.ready = true;
        resolve();
      };
      const finishErr = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.ready = false;
        reject(err);
      };

      proc.stdout.setEncoding("utf8");
      proc.stderr.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => {
        this.buf += chunk;
        let idx: number;
        while ((idx = this.buf.indexOf("\n")) >= 0) {
          const line = this.buf.slice(0, idx).trim();
          this.buf = this.buf.slice(idx + 1);
          if (!line) continue;
          this.handleLine(line, finishOk, finishErr);
        }
      });
      proc.stderr.on("data", (chunk: string) => {
        const t = chunk.trim();
        if (t) {
          this.stderrTail.push(t);
          if (this.stderrTail.length > 40) this.stderrTail.shift();
        }
      });
      proc.on("error", (err) => finishErr(new Error("VoxCPM worker spawn 실패: " + err.message)));
      proc.on("exit", (code) => {
        const tail = this.stderrTail.slice(-8).join("\n");
        const err = new Error("VoxCPM worker 종료 code=" + String(code) + (tail ? "\n" + tail : ""));
        this.rejectAll(err);
        this.proc = null;
        this.ready = false;
        finishErr(err);
      });
    });
  }

  private handleLine(
    line: string,
    onReady: () => void,
    onErr: (e: Error) => void,
  ): void {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(line) as Record<string, unknown>; }
    catch { return; }
    if (msg.event === "ready") {
      onReady();
      return;
    }
    if (msg.event === "error" && !msg.id) {
      onErr(new Error(String(msg.error || "VoxCPM worker error")));
      return;
    }
    const id = String(msg.id || "");
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (msg.ok) {
      pending.resolve({
        output: String(msg.output || ""),
        duration: Number(msg.duration) || 0,
      });
    } else {
      pending.reject(new Error(String(msg.error || "synth failed")));
    }
  }

  private requestSynth(text: string, output: string, settings?: AppSettings): Promise<{ output: string; duration: number }> {
    const proc = this.proc;
    if (!proc || !this.ready) return Promise.reject(new Error("VoxCPM worker 가 준비되지 않았습니다"));
    const id = String(++this.seq);
    const refWav = settings ? this.resolvedRef(settings) : "";
    const promptText = settings?.voxcpmPromptText?.trim() || "";
    return new Promise((resolve, reject) => {
      this.pending.set(id, { id, resolve, reject });
      const payload: Record<string, any> = { id, cmd: "synth", text, output };
      if (refWav) {
        payload.reference_wav = refWav;
        payload.prompt_audio = refWav;
      }
      if (promptText) {
        payload.prompt_text = promptText;
      }
      proc.stdin.write(JSON.stringify(payload) + "\n", (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  private rejectAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

function sidecarFor(wav: string): string {
  return wav.replace(/\.wav$/i, ".txt");
}

export class IrodoriTts {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ready = false;
  private starting: Promise<void> | null = null;
  private buf = "";
  private seq = 0;
  private generation = 0;
  private pending = new Map<string, Pending>();

  constructor(private readonly onStatus: (s: TtsStatus) => void) {}

  stopWorker(): void {
    this.ready = false;
    this.starting = null;
    if (this.proc && !this.proc.killed) {
      try { this.proc.stdin.write(JSON.stringify({ op: "shutdown" }) + "\n"); } catch {}
      try { this.proc.kill(); } catch {}
    }
    this.proc = null;
  }

  async speak(settings: AppSettings, text: string): Promise<TtsPlay> {
    const spoken = text.trim();
    if (!spoken) return { kind: "none" };

    const gen = ++this.generation;
    try {
      await this.ensureWorker(settings);
      if (gen !== this.generation) return { kind: "none" };
      this.onStatus("synthesizing");

      const outPath = path.join(os.tmpdir(), `miku-irodori-${Date.now()}-${gen}.wav`);
      const resWav = resolveVoiceWav(settings.voxcpmReferenceWav);

      const result = await this.requestSynth(spoken, resWav, outPath);
      if (gen !== this.generation) return { kind: "none" };

      const buf = fs.readFileSync(result.output);
      try { fs.unlinkSync(result.output); } catch {}

      return {
        kind: "wav",
        b64: buf.toString("base64"),
        text: spoken,
        duration: result.duration,
      };
    } catch (err: any) {
      console.warn("Irodori-TTS synthesis failed:", err);
      if (settings.ttsWebFallback) {
        return { kind: "web", text: spoken, fallback: true, reason: err.message };
      }
      throw err;
    }
  }

  private async ensureWorker(settings: AppSettings): Promise<void> {
    if (this.proc && this.ready) return;
    if (this.starting) return this.starting;

    this.onStatus("loading");
    this.starting = this.spawnWorker(settings);
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private spawnWorker(settings: AppSettings): Promise<void> {
    return new Promise((resolve, reject) => {
      const python = settings.irodoriPythonPath || "C:\\Users\\a4jud\\.vdc-engines\\Irodori-TTS\\.venv\\Scripts\\python.exe";
      const worker = "C:\\Users\\a4jud\\Voice-Design-Cloner\\modules\\irodori_worker.py";
      const irodoriRoot = "C:\\Users\\a4jud\\.vdc-engines\\Irodori-TTS";

      if (!fs.existsSync(python)) return reject(new Error("Irodori python 경로를 찾을 수 없습니다: " + python));
      if (!fs.existsSync(worker)) return reject(new Error("irodori_worker.py 를 찾을 수 없습니다: " + worker));

      const proc = spawn(toWindowlessPython(python), ["-u", worker], {
        cwd: irodoriRoot,
        env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.proc = proc;

      const timer = setTimeout(() => {
        reject(new Error("Irodori-TTS 워커 기동 시간 초과 (90초)"));
        this.stopWorker();
      }, 90000);

      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => {
        this.buf += chunk;
        let idx: number;
        while ((idx = this.buf.indexOf("\n")) >= 0) {
          const line = this.buf.slice(0, idx).trim();
          this.buf = this.buf.slice(idx + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.event === "ready" || msg.ok !== undefined) {
              clearTimeout(timer);
              this.ready = true;
              resolve();
            }
          } catch {}
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        this.ready = false;
        reject(err);
      });
    });
  }

  private requestSynth(text: string, refWav: string, outPath: string): Promise<{ output: string; duration: number }> {
    const proc = this.proc;
    if (!proc) return Promise.reject(new Error("Irodori worker 가 켜져 있지 않습니다"));
    const id = String(++this.seq);

    return new Promise((resolve, reject) => {
      this.pending.set(id, { id, resolve, reject });
      const req = {
        op: "synthesize",
        mode: "clone",
        text,
        ref_wav: refWav,
        out_path: outPath,
        target_sr: 44100,
        seed: null,
      };

      proc.stdin.write(JSON.stringify(req) + "\n", (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });

      // Timeout for single sentence synthesis (15s)
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve({ output: outPath, duration: Math.max(0.8, text.length * 0.1) });
        }
      }, 15000);
    });
  }
}


export class FishAudioTts {
  constructor(private readonly onStatus: (s: TtsStatus) => void) {}

  async speak(settings: AppSettings, text: string): Promise<TtsPlay> {
    const rawSpoken = text.trim();
    if (!rawSpoken) return { kind: "none" };

    const apiKey = (settings.fishApiKey || "").trim();
    if (!apiKey) {
      console.warn("Fish Audio API 키가 입력되지 않았습니다.");
      if (settings.ttsWebFallback) {
        return {
          kind: "web",
          text: rawSpoken,
          fallback: true,
          reason: "Fish Audio API 키가 비어있습니다. 환경설정(⚙️)에서 fish.audio API 키를 입력해주세요.",
        };
      }
      return { kind: "none" };
    }

    // Defensive speech sanitization: strip any emoji/pictograph byte sequences that trigger Chinese token flips
    let cleanSpoken = sanitizeSpeechForTts(rawSpoken);
    if (!cleanSpoken) return { kind: "none" };

    // Guaranteed terminal sentence punctuation to force clean model EOS and eliminate trailing sighs/groans
    if (!/[.!?~…\u3002\uFF01\uFF1F]$/.test(cleanSpoken)) {
      cleanSpoken += /[\u3040-\u30ff\u4e00-\u9faf]$/.test(cleanSpoken) ? "。" : ".";
    }

    this.onStatus("synthesizing");
    const voiceId = (settings.fishVoiceId || "").trim() || "acc8237220d8470985ec9be6c4c480a9";
    const latency = settings.fishLatency || "low";

    const requestPayload = {
      text: cleanSpoken,
      reference_id: voiceId,
      format: "wav",
      latency,
      normalize: true,
      temperature: 0.5,
      top_p: 0.7,
      repetition_penalty: 1.2,
      max_new_tokens: 1024,
    };

    if (process.env.NODE_ENV !== "production") {
      console.log("[FishAudio Request]", JSON.stringify(requestPayload));
    }

    try {
      const resp = await fetch("https://api.fish.audio/v1/tts", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "model": "s2.1-pro-free",
          "Content-Type": "application/json",
          "accept": "audio/wav",
        },
        body: JSON.stringify(requestPayload),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        throw new Error(`Fish Audio API 오류 (${resp.status}): ${errText}`);
      }

      const arrayBuffer = await resp.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      if (buf.length === 0) {
        throw new Error("Fish Audio 응답 데이터가 비어있습니다.");
      }

      let duration = Math.max(0.6, cleanSpoken.length * 0.1);
      if (buf.length >= 44 && buf.toString("ascii", 0, 4) === "RIFF") {
        const byteRate = buf.readUInt32LE(28);
        const dataLen = buf.length - 44;
        if (byteRate > 0) {
          duration = dataLen / byteRate;
        }
      }

      return {
        kind: "wav",
        b64: buf.toString("base64"),
        text: cleanSpoken,
        duration: Math.max(0.5, duration),
      };
    } catch (err: any) {
      console.warn("Fish Audio TTS failed:", err);
      if (settings.ttsWebFallback) {
        return { kind: "web", text: cleanSpoken || rawSpoken, fallback: true, reason: err.message };
      }
      throw err;
    }
  }
}

export type DetectedLanguage = "ko" | "ja" | "en" | "zh" | "other";

export function detectLanguage(text: string): DetectedLanguage {
  const trimmed = text.trim();
  if (!trimmed) return "other";

  const hangulMatches = trimmed.match(/[\uAC00-\uD7AF\u1100-\u11FF]/g) || [];
  const kanaMatches = trimmed.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || [];
  const hanziMatches = trimmed.match(/[\u4E00-\u9FFF]/g) || [];
  const latinMatches = trimmed.match(/[a-zA-Z]/g) || [];

  const hangulCount = hangulMatches.length;
  const kanaCount = kanaMatches.length;
  const hanziCount = hanziMatches.length;
  const latinCount = latinMatches.length;

  // If there's Kana, it's definitely Japanese (even if it contains Kanji)
  if (kanaCount > 0) return "ja";
  // If there's Hangul, it's Korean
  if (hangulCount > 0) return "ko";
  // If only Hanzi without Kana/Hangul, it's Chinese
  if (hanziCount > 0 && kanaCount === 0 && hangulCount === 0) return "zh";
  // If mostly Latin English
  if (latinCount > 0 && hangulCount === 0 && kanaCount === 0 && hanziCount === 0) return "en";

  return "other";
}

export function resolveVoiceProfileConfig(
  profile: CharacterVoiceProfile | undefined,
  text: string,
  baseSettings: AppSettings
): {
  engine: TtsProvider;
  effectiveSettings: AppSettings;
  detectedLang: DetectedLanguage;
} {
  const detectedLang = detectLanguage(text);

  if (!profile) {
    return {
      engine: baseSettings.ttsProvider,
      effectiveSettings: baseSettings,
      detectedLang,
    };
  }

  // Determine target engine based on detected language
  let engine: TtsProvider = profile.preferredEngine?.default || baseSettings.ttsProvider;
  if (detectedLang === "ko" && profile.preferredEngine?.ko) {
    engine = profile.preferredEngine.ko;
  } else if (detectedLang === "ja" && profile.preferredEngine?.ja) {
    engine = profile.preferredEngine.ja;
  } else if (detectedLang === "en" && profile.preferredEngine?.en) {
    engine = profile.preferredEngine.en;
  }

  // Clone settings and apply language-specific parameters
  const effective: AppSettings = { ...baseSettings, ttsProvider: engine };

  if (engine === "voxcpm" && profile.voxcpm) {
    if (detectedLang === "ko") {
      const koRef = profile.voxcpm.koReferenceWav || profile.voxcpm.defaultReferenceWav || baseSettings.voxcpmReferenceWav;
      effective.voxcpmReferenceWav = koRef;
      effective.ttsVoiceId = koRef;
      if (profile.voxcpm.koPromptText) {
        effective.voxcpmPromptText = profile.voxcpm.koPromptText;
      }
    } else if (detectedLang === "ja") {
      const jaRef = profile.voxcpm.jaReferenceWav || profile.voxcpm.defaultReferenceWav || baseSettings.voxcpmReferenceWav;
      effective.voxcpmReferenceWav = jaRef;
      effective.ttsVoiceId = jaRef;
      if (profile.voxcpm.jaPromptText) {
        effective.voxcpmPromptText = profile.voxcpm.jaPromptText;
      }
    } else {
      const defRef = profile.voxcpm.defaultReferenceWav || baseSettings.voxcpmReferenceWav;
      effective.voxcpmReferenceWav = defRef;
      effective.ttsVoiceId = defRef;
    }
  } else if (engine === "fish" && profile.fish) {
    if (detectedLang === "ko" && profile.fish.koReferenceId) {
      effective.fishVoiceId = profile.fish.koReferenceId;
    } else if (detectedLang === "ja" && profile.fish.jaReferenceId) {
      effective.fishVoiceId = profile.fish.jaReferenceId;
    } else if (profile.fish.referenceId) {
      effective.fishVoiceId = profile.fish.referenceId;
    }
  } else if (engine === "irodori" && profile.irodori) {
    if (profile.irodori.loraId) {
      effective.irodoriLoraId = profile.irodori.loraId;
    }
  }

  return { engine, effectiveSettings: effective, detectedLang };
}
