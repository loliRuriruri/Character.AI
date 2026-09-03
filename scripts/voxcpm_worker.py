#!/usr/bin/env python3
"""Persistent VoxCPM2 worker for MikuChat-v2.

JSONL on stdin:
  {"id":"1","cmd":"synth","text":"...","output":"optional.wav"}
  {"id":"1","cmd":"ping"}
JSONL on stdout (only protocol lines):
  {"event":"ready","device":"cuda","cuda":true,"sample_rate":48000}
  {"id":"1","ok":true,"output":"...","duration":1.2,"sample_rate":48000}
  {"id":"1","ok":false,"error":"..."}
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import traceback
from pathlib import Path

def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def resolve_device(requested: str) -> str:
    req = (requested or "auto").strip().lower()
    import torch
    if req in ("", "auto"):
        return "cuda" if torch.cuda.is_available() else "cpu"
    if req.startswith("cuda"):
        if not torch.cuda.is_available():
            log("CUDA requested but torch.cuda.is_available() is False; using CPU")
            return "cpu"
        return req
    return req


def load_model(hf_model_id: str, device: str):
    from voxcpm import VoxCPM

    log(f"Loading VoxCPM2 hf={hf_model_id} device={device} (denoiser off, optimize off)")
    model = VoxCPM.from_pretrained(
        hf_model_id,
        load_denoiser=False,
        optimize=False,
        device=device,
    )
    log("Model ready")
    return model


def main() -> int:
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="MikuChat VoxCPM2 JSONL worker")
    parser.add_argument("--reference-audio", required=True)
    parser.add_argument("--prompt-audio", default="")
    parser.add_argument("--prompt-text", default="")
    parser.add_argument("--prompt-file", default="")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--hf-model-id", default="openbmb/VoxCPM2")
    parser.add_argument("--cfg-value", type=float, default=1.6)
    parser.add_argument("--inference-timesteps", type=int, default=10)
    args = parser.parse_args()

    ref = Path(args.reference_audio)
    if not ref.is_file():
        emit({"event": "error", "error": f"reference wav missing: {ref}"})
        return 2

    prompt_audio = args.prompt_audio.strip() or str(ref)
    prompt_text = args.prompt_text.strip()
    if not prompt_text and args.prompt_file:
        prompt_text = Path(args.prompt_file).read_text(encoding="utf-8").strip()
    if not prompt_text:
        sidecar = ref.with_suffix(".txt")
        if sidecar.is_file():
            prompt_text = sidecar.read_text(encoding="utf-8").strip()

    device = resolve_device(args.device)
    try:
        import torch
        cuda = bool(torch.cuda.is_available())
        gpu = torch.cuda.get_device_name(0) if cuda else ""
        log(f"torch={torch.__version__} cuda={cuda} gpu={gpu} device={device}")
    except Exception as exc:
        emit({"event": "error", "error": f"torch import failed: {exc}"})
        return 3

    try:
        model = load_model(args.hf_model_id, device)
    except Exception as exc:
        traceback.print_exc()
        emit({"event": "error", "error": f"model load failed: {exc}"})
        return 4

    sample_rate = int(getattr(getattr(model, "tts_model", None), "sample_rate", 48000) or 48000)
    emit({
        "event": "ready",
        "device": device,
        "cuda": device.startswith("cuda"),
        "sample_rate": sample_rate,
        "reference": str(ref),
    })

    import soundfile as sf

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
        text = str(msg.get("text") or "").strip()
        if not text:
            emit({"id": req_id, "ok": False, "error": "empty text"})
            continue
        out = str(msg.get("output") or "").strip()
        if not out:
            fd, out = tempfile.mkstemp(prefix="mikuchat-tts-", suffix=".wav")
            os.close(fd)
        try:
            req_ref = msg.get("reference_wav") or str(ref)
            req_prompt_text = msg.get("prompt_text") or prompt_text
            req_prompt_audio = msg.get("prompt_audio") or prompt_audio or str(req_ref)
            if not req_prompt_text and req_ref:
                sidecar = Path(req_ref).with_suffix(".txt")
                if sidecar.is_file():
                    req_prompt_text = sidecar.read_text(encoding="utf-8").strip()

            # Check if target text is Korean while prompt_text is Japanese/foreign
            import re
            has_korean = bool(re.search(r'[가-힣]', text))
            prompt_is_foreign = bool(re.search(r'[ぁ-ゔァ-ヴ一-龠]', req_prompt_text or ""))

            # In cross-lingual mode (Korean text with Japanese voice reference):
            # Do NOT force In-Context Japanese continuation! Use pure zero-shot speaker timbre reference.
            # This enables native Korean prosody, natural pitch, and eliminates robotic staccato pauses.
            use_in_context = bool(req_prompt_text) and not (has_korean and prompt_is_foreign)

            p_wav = req_prompt_audio if use_in_context else None
            p_txt = req_prompt_text if use_in_context else None

            # Smooth CFG for Korean to prevent high-frequency pitch clipping
            cfg = float(msg.get("cfg_value") or args.cfg_value)
            if has_korean and cfg > 1.6:
                cfg = 1.5

            wav = model.generate(
                text=text,
                prompt_wav_path=p_wav,
                prompt_text=p_txt,
                reference_wav_path=str(req_ref),
                cfg_value=cfg,
                inference_timesteps=int(msg.get("inference_timesteps") or args.inference_timesteps),
                seed=msg.get("seed"),
            )
            sf.write(out, wav, sample_rate)
            duration = float(len(wav) / sample_rate) if sample_rate else 0.0
            if duration <= 0:
                raise RuntimeError("synthesized wav has zero duration")
            emit({
                "id": req_id,
                "ok": True,
                "output": out,
                "duration": duration,
                "sample_rate": sample_rate,
            })
        except Exception as exc:
            traceback.print_exc()
            emit({"id": req_id, "ok": False, "error": str(exc)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
