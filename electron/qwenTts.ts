import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppSettings, TtsStatus } from "../src/shared/types";
import { resolveVoiceWav, getVoiceReferenceAsset } from "./voices";
import { type TtsPlay } from "./tts";

const here = path.dirname(fileURLToPath(import.meta.url));

type Pending = {
  id: string;
  resolve: (v: { output: string; duration: number }) => void;
  reject: (e: Error) => void;
};

function exists(p: string): boolean {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

export function resolveQwen3WorkerScript(): string {
  const candidates = [
    path.join(here, "../scripts/qwen3_tts_worker.py"),
    path.join(process.cwd(), "scripts/qwen3_tts_worker.py"),
    "C:\\TEST\\MikuChat-v3\\scripts\\qwen3_tts_worker.py",
  ];
  const hit = candidates.find(exists);
  if (!hit) throw new Error("qwen3_tts_worker.py 를 찾을 수 없습니다: " + candidates.join(" | "));
  return hit;
}

function sidecarFor(wav: string): string {
  return wav.replace(/\.wav$/i, ".txt");
}

export class Qwen3Tts {
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
    if (settings.ttsProvider === "qwen3tts" && settings.ttsEnabled) {
      await this.ensureWorker(settings).catch((err) => console.warn("Qwen3-TTS prewarm skipped:", err));
    }
  }

  stopWorker(): void {
    this.rejectAll(new Error("Qwen3-TTS worker stopped"));
    this.ready = false;
    this.starting = null;
    this.startedWith = "";
    if (this.proc && !this.proc.killed) {
      try { this.proc.stdin.write(JSON.stringify({ cmd: "quit" }) + "\n"); } catch {}
      try { this.proc.stdin.end(); } catch {}
      try { this.proc.kill(); } catch {}
    }
    this.proc = null;
  }

  async speak(settings: AppSettings, text: string): Promise<TtsPlay> {
    const spoken = text.trim();
    if (!spoken) return { kind: "none" };
    if (!settings.ttsEnabled) {
      return { kind: "viseme", text: spoken, duration: Math.max(0.8, spoken.length * 0.08) };
    }
    if (settings.ttsProvider !== "qwen3tts") {
      return { kind: "web", text: spoken, fallback: false };
    }
    const gen = ++this.generation;
    try {
      await this.ensureWorker(settings);
      if (gen !== this.generation) return { kind: "none" };
      this.onStatus("synthesizing");
      if (gen !== this.generation) return { kind: "none" };
      const outPath = path.join(os.tmpdir(), `mikuchat-qwen3-${Date.now()}-${gen}.wav`);
      const result = await this.requestSynth(spoken, outPath, settings);
      if (gen !== this.generation) {
        this.onStatus("idle");
        return { kind: "none" };
      }
      const buf = fs.readFileSync(result.output);
      if (buf.length < 44) {
        this.onStatus("idle");
        throw new Error("합성 wav 가 너무 작습니다");
      }
      try { fs.unlinkSync(result.output); } catch {}
      this.onStatus("idle");
      return {
        kind: "wav",
        b64: buf.toString("base64"),
        text: spoken,
        duration: result.duration,
      };
    } catch (err) {
      this.onStatus("idle");
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
    const ref = settings.qwen3ReferenceWav?.trim() || settings.ttsVoiceId?.trim() || settings.voxcpmReferenceWav?.trim() || "C:\\TEST\\MikuChat-v3\\assets\\tts\\my_voice_ref.wav";
    return resolveVoiceWav(ref);
  }

  private resolvedPromptText(settings: AppSettings, refWav: string): string {
    const asset = getVoiceReferenceAsset(refWav);
    if (asset && asset.transcript) {
      return asset.transcript;
    }
    return settings.qwen3PromptText?.trim() || settings.voxcpmPromptText?.trim() || "";
  }

  private fingerprint(settings: AppSettings): string {
    return [
      settings.qwen3PythonPath || "C:\\Users\\a4jud\\Qwen3-TTS\\.venv\\Scripts\\python.exe",
      settings.qwen3Device || "cuda:0",
    ].join("|");
  }

  private async ensureWorker(settings: AppSettings): Promise<void> {
    const python = settings.qwen3PythonPath?.trim() || "C:\\Users\\a4jud\\Qwen3-TTS\\.venv\\Scripts\\python.exe";
    const ref = this.resolvedRef(settings);
    if (!exists(python)) throw new Error("Qwen3-TTS python 경로가 없습니다: " + python);
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
      void this.requestSynth("네.", path.join(os.tmpdir(), "miku-qwen3-warmup.wav"), settings).catch(() => {});
    } finally {
      this.starting = null;
    }
  }

  private spawnWorker(settings: AppSettings): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = resolveQwen3WorkerScript();
      const ref = this.resolvedRef(settings);
      const promptFile = sidecarFor(ref);
      const args = [
        "-u",
        worker,
        "--reference-audio", ref,
        "--device", settings.qwen3Device || "cuda:0",
        "--hf-model-id", "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
      ];
      const pText = this.resolvedPromptText(settings, ref);
      if (pText) {
        const tempPromptFile = path.join(os.tmpdir(), `mikuchat-qwen3-prompt-${Date.now()}.txt`);
        try { fs.writeFileSync(tempPromptFile, pText, "utf8"); } catch {}
        args.push("--prompt-file", tempPromptFile);
      } else if (exists(promptFile)) {
        args.push("--prompt-file", promptFile);
      }

      const pythonPath = settings.qwen3PythonPath?.trim() || "C:\\Users\\a4jud\\Qwen3-TTS\\.venv\\Scripts\\python.exe";
      const proc = spawn(pythonPath, args, {
        env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.proc = proc;
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Qwen3-TTS 모델 로딩 시간 초과 (180초). GPU/가중치 상태를 확인하세요."));
          this.stopWorker();
        }
      }, 180000);

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
      proc.on("error", (err) => finishErr(new Error("Qwen3-TTS worker spawn 실패: " + err.message)));
      proc.on("exit", (code) => {
        const tail = this.stderrTail.slice(-8).join("\n");
        const err = new Error("Qwen3-TTS worker 종료 code=" + String(code) + (tail ? "\n" + tail : ""));
        this.rejectAll(err);
        this.proc = null;
        this.ready = false;
        finishErr(err);
      });
    });
  }

  private handleLine(line: string, onReady: () => void, onErr: (e: Error) => void): void {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(line) as Record<string, unknown>; }
    catch { return; }
    if (msg.event === "ready") {
      onReady();
      return;
    }
    if (msg.event === "error" && !msg.id) {
      onErr(new Error(String(msg.error || "Qwen3-TTS worker error")));
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
    if (!proc || !this.ready) return Promise.reject(new Error("Qwen3-TTS worker 가 준비되지 않았습니다"));
    const id = String(++this.seq);
    const refWav = settings ? this.resolvedRef(settings) : "";
    const promptText = settings && refWav ? this.resolvedPromptText(settings, refWav) : "";
    return new Promise((resolve, reject) => {
      this.pending.set(id, { id, resolve, reject });
      const payload: Record<string, any> = { id, cmd: "synth", text, output };
      if (refWav) {
        payload.reference_wav = refWav;
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
