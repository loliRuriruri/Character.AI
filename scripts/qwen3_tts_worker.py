#!/usr/bin/env python3
"""Persistent Qwen3-TTS 1.7B-Base worker for MikuChat-v3.

JSONL on stdin:
  {"id":"1","cmd":"synth","text":"...","output":"optional.wav","language":"Korean","reference_wav":"..."}
  {"id":"1","cmd":"create_prompt","reference_wav":"...","prompt_text":"..."}
  {"id":"1","cmd":"ping"}
  {"id":"1","cmd":"quit"}

JSONL on stdout:
  {"event":"ready","device":"cuda:0","cuda":true,"sample_rate":24000,"reference":"..."}
  {"id":"1","ok":true,"output":"...","duration":2.1,"sample_rate":24000,"generation_time":0.45}
  {"id":"1","ok":false,"error":"..."}
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any, Dict, Optional

_real_stdout = sys.__stdout__
sys.stdout = sys.stderr

def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def emit(obj: dict) -> None:
    _real_stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    _real_stdout.flush()


def resolve_device(requested: str) -> str:
    req = (requested or "auto").strip().lower()
    import torch
    if req in ("", "auto"):
        return "cuda:0" if torch.cuda.is_available() else "cpu"
    if req.startswith("cuda"):
        if not torch.cuda.is_available():
            log("CUDA requested but torch.cuda.is_available() is False; falling back to CPU")
            return "cpu"
        if req == "cuda":
            return "cuda:0"
        return req
    return req


def detect_language_for_qwen(text: str, requested_lang: Optional[str] = None) -> str:
    if requested_lang:
        rl = requested_lang.strip().lower()
        if rl in ("ko", "korean", "한국어"):
            return "Korean"
        if rl in ("ja", "japanese", "일본어"):
            return "Japanese"
        if rl in ("en", "english", "영어"):
            return "English"
        if rl in ("zh", "chinese", "중국어"):
            return "Chinese"

    # Auto-detection heuristic
    hangul = bool(re.search(r'[\uAC00-\uD7AF\u1100-\u11FF]', text))
    kana = bool(re.search(r'[\u3040-\u309F\u30A0-\u30FF]', text))
    if hangul:
        return "Korean"
    if kana:
        return "Japanese"
    hanzi = bool(re.search(r'[\u4E00-\u9FFF]', text))
    if hanzi:
        # Default Kanji-heavy phrases in MikuChat to Japanese rather than Chinese
        return "Japanese"
    latin = bool(re.search(r'[a-zA-Z]', text))
    if latin:
        return "English"
    return "Korean"


def main() -> int:
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(_real_stdout, "reconfigure"):
        _real_stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="MikuChat Qwen3-TTS JSONL worker")
    parser.add_argument("--reference-audio", default="")
    parser.add_argument("--prompt-text", default="")
    parser.add_argument("--prompt-file", default="")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--hf-model-id", default="Qwen/Qwen3-TTS-12Hz-1.7B-Base")
    args = parser.parse_args()

    default_ref = Path(args.reference_audio) if args.reference_audio else None
    default_prompt_text = args.prompt_text.strip()
    if not default_prompt_text and args.prompt_file:
        pf = Path(args.prompt_file)
        if pf.is_file():
            default_prompt_text = pf.read_text(encoding="utf-8").strip()
    if not default_prompt_text and default_ref and default_ref.is_file():
        sidecar = default_ref.with_suffix(".txt")
        if sidecar.is_file():
            default_prompt_text = sidecar.read_text(encoding="utf-8").strip()

    device = resolve_device(args.device)

    try:
        import torch
        import soundfile as sf
        from qwen_tts import Qwen3TTSModel
        cuda = bool(torch.cuda.is_available())
        gpu = torch.cuda.get_device_name(0) if cuda else "CPU"
        log(f"Loading Qwen3-TTS: torch={torch.__version__} cuda={cuda} gpu={gpu} device={device} model={args.hf_model_id}")
    except Exception as exc:
        traceback.print_exc()
        emit({"event": "error", "error": f"Failed to import dependencies: {exc}"})
        return 1

    try:
        model = Qwen3TTSModel.from_pretrained(
            args.hf_model_id,
            device_map=device,
            dtype=torch.bfloat16 if device.startswith("cuda") else torch.float32,
        )
        log("Qwen3-TTS model loaded successfully.")
    except Exception as exc:
        traceback.print_exc()
        emit({"event": "error", "error": f"Failed to load model {args.hf_model_id}: {exc}"})
        return 2

    # In-memory prompt cache: key -> VoiceClonePromptItem list
    prompt_cache: Dict[str, Any] = {}

    def get_or_create_prompt(ref_audio: str, ref_txt: str, x_vector_only: bool) -> Optional[Any]:
        if not ref_audio or not Path(ref_audio).is_file():
            return None
        cache_key = f"{Path(ref_audio).resolve()}|{ref_txt.strip()}|{x_vector_only}"
        if cache_key in prompt_cache:
            return prompt_cache[cache_key]
        try:
            t0 = time.perf_counter()
            log(f"Creating voice clone prompt for {ref_audio} (x_vector_only={x_vector_only})...")
            p = model.create_voice_clone_prompt(
                ref_audio=ref_audio,
                ref_text=ref_txt if not x_vector_only else None,
                x_vector_only_mode=x_vector_only,
            )
            prompt_cache[cache_key] = p
            log(f"Voice clone prompt created and cached in {time.perf_counter() - t0:.3f}s")
            return p
        except Exception as e:
            log(f"Warning: Failed to create voice clone prompt: {e}")
            return None

    # Pre-warm default reference audio prompt if provided
    if default_ref and default_ref.is_file():
        get_or_create_prompt(str(default_ref), default_prompt_text, False)

    sample_rate = 24000
    emit({
        "event": "ready",
        "device": device,
        "cuda": device.startswith("cuda"),
        "sample_rate": sample_rate,
        "reference": str(default_ref) if default_ref else "",
        "model": args.hf_model_id,
    })

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            emit({"ok": False, "error": f"bad json: {exc}"})
            continue

        cmd = msg.get("cmd") or "synth"
        req_id = str(msg.get("id") or "")

        if cmd == "ping":
            emit({"id": req_id, "ok": True, "event": "pong", "device": device})
            continue

        if cmd == "quit":
            emit({"id": req_id, "ok": True, "event": "bye"})
            return 0

        if cmd == "create_prompt":
            ref_path = str(msg.get("reference_wav") or msg.get("reference_audio") or "").strip()
            txt = str(msg.get("prompt_text") or msg.get("reference_text") or "").strip()
            x_vec = bool(msg.get("x_vector_only", False))
            if not txt and ref_path:
                sidecar = Path(ref_path).with_suffix(".txt")
                if sidecar.is_file():
                    txt = sidecar.read_text(encoding="utf-8").strip()
            p = get_or_create_prompt(ref_path, txt, x_vec)
            emit({"id": req_id, "ok": p is not None, "cached": p is not None})
            continue

        # Synthesis command
        text = str(msg.get("text") or "").strip()
        if not text:
            emit({"id": req_id, "ok": False, "error": "empty text"})
            continue

        out = str(msg.get("output") or "").strip()
        if not out:
            fd, out = tempfile.mkstemp(prefix="mikuchat-qwen3-", suffix=".wav")
            os.close(fd)

        ref_path = str(msg.get("reference_wav") or msg.get("reference_audio") or "").strip()
        if not ref_path and default_ref and default_ref.is_file():
            ref_path = str(default_ref)

        ref_txt = str(msg.get("prompt_text") or msg.get("reference_text") or "").strip()
        if not ref_txt:
            if ref_path:
                sidecar = Path(ref_path).with_suffix(".txt")
                if sidecar.is_file():
                    ref_txt = sidecar.read_text(encoding="utf-8").strip()
            if not ref_txt:
                ref_txt = default_prompt_text

        x_vec = bool(msg.get("x_vector_only", False))
        lang = detect_language_for_qwen(text, msg.get("language"))

        try:
            cached_prompt = get_or_create_prompt(ref_path, ref_txt, x_vec) if ref_path else None
            t0 = time.perf_counter()

            if cached_prompt is not None:
                wavs, sr = model.generate_voice_clone(
                    text=text,
                    language=lang,
                    voice_clone_prompt=cached_prompt,
                )
            elif ref_path and Path(ref_path).is_file():
                wavs, sr = model.generate_voice_clone(
                    text=text,
                    language=lang,
                    ref_audio=ref_path,
                    ref_text=ref_txt if not x_vec else None,
                    x_vector_only_mode=x_vec,
                )
            else:
                emit({"id": req_id, "ok": False, "error": "Reference audio not provided or not found"})
                continue

            gen_duration = time.perf_counter() - t0
            audio_data = wavs[0] if isinstance(wavs, (list, tuple)) else wavs
            if hasattr(audio_data, "cpu"):
                audio_data = audio_data.cpu().float().numpy()

            sf.write(out, audio_data, sr)
            audio_duration = float(len(audio_data) / sr) if sr else 0.0

            if audio_duration <= 0:
                raise RuntimeError("synthesized wav has zero duration")

            emit({
                "id": req_id,
                "ok": True,
                "output": out,
                "duration": audio_duration,
                "sample_rate": sr,
                "generation_time": round(gen_duration, 3),
                "rtf": round(gen_duration / audio_duration, 3) if audio_duration > 0 else 0,
                "language": lang,
            })
        except Exception as exc:
            traceback.print_exc()
            emit({"id": req_id, "ok": False, "error": str(exc)})

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
