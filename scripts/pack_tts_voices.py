# -*- coding: utf-8 -*-
from __future__ import annotations
import json, math, re, shutil, struct, wave
from pathlib import Path

OUTPUT = Path(r"C:\Users\a4jud\Voice-Design-Cloner\output")
LAB = OUTPUT / "lora_data" / "lab"
DEST_ROOT = Path(r"C:\TEST\MikuChat-v2\assets\tts")
VOICES_DIR = DEST_ROOT / "voices"
CATALOG = DEST_ROOT / "voices.json"
PROJ = Path(r"C:\TEST\MikuChat-v2")

FILLER_RE = re.compile(r"^(ふ+っ?ふ*|うふふ*|あ+はは*|はっ+|うん+|えっと|あの+|はい。?|ええ。?|…+|ー+|ん+|はぁ+|ほぅ。?)$")
BR_RE = re.compile(r"<br\s*/?>", re.I)
TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")

SPEAKERS = [
    {"id": "my_voice_01", "displayName": "\ub0b4 \ubaa9\uc18c\ub9ac 1", "kind": "lab", "name": "my_voice_01", "forceStem": None},
    {"id": "my_voice_02", "displayName": "\ub0b4 \ubaa9\uc18c\ub9ac 2", "kind": "lab", "name": "my_voice_02", "forceStem": None},
    {"id": "my_voice_03", "displayName": "\ub0b4 \ubaa9\uc18c\ub9ac 3", "kind": "lab", "name": "my_voice_03", "forceStem": "0073"},
    {"id": "reze", "displayName": "\ub808\uc81c", "kind": "lab", "name": "reze", "forceStem": None},
    {"id": "reze2", "displayName": "\ub808\uc81c 2", "kind": "lab", "name": "reze2", "forceStem": None},
    {"id": "test_voice_200", "displayName": "\ud14c\uc2a4\ud2b8 \ubcf4\uc774\uc2a4", "kind": "lab", "name": "test_voice_200", "forceStem": None},
    {"id": "ayaka", "displayName": "\uc544\uc57c\uce74", "kind": "raw", "name": "Ayaka", "forceStem": None},
    {"id": "barbara", "displayName": "\ubc14\ubc14\ub77c", "kind": "raw", "name": "Barbara", "forceStem": None},
    {"id": "ganyu", "displayName": "\uac10\uc6b0", "kind": "raw", "name": "Ganyu", "forceStem": None},
    {"id": "hu_tao", "displayName": "\ud638\ub450", "kind": "raw", "name": "Hu_Tao", "forceStem": None},
    {"id": "keqing", "displayName": "\uac01\uccad", "kind": "raw", "name": "Keqing", "forceStem": None},
    {"id": "mona", "displayName": "\ubaa8\ub098", "kind": "raw", "name": "Mona", "forceStem": None},
    {"id": "nilou", "displayName": "\ub2d0\ub8e8", "kind": "raw", "name": "Nilou", "forceStem": None},
]

def clean_text(text):
    text = BR_RE.sub(" ", text)
    text = TAG_RE.sub(" ", text)
    text = text.replace("\\n", " ").replace("\u3000", " ")
    return SPACE_RE.sub(" ", text).strip()

def parse_transcripts(path):
    mapping = {}
    if not path.is_file():
        return mapping
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        if "|" in line:
            stem, text = line.split("|", 1)
        elif ":" in line:
            stem, text = line.split(":", 1)
        elif "\t" in line:
            stem, text = line.split("\t", 1)
        else:
            continue
        stem = Path(stem.strip()).stem
        text = clean_text(text)
        if stem and text:
            mapping[stem] = text
            mapping[stem.lstrip("0") or "0"] = text
    return mapping

def wav_stats(path):
    try:
        with wave.open(str(path), "rb") as w:
            nch = w.getnchannels()
            sw = w.getsampwidth()
            sr = w.getframerate()
            n = w.getnframes()
            if sr <= 0 or n <= 0 or sw != 2:
                return None
            raw = w.readframes(n)
    except Exception:
        return None
    if len(raw) < 4:
        return None
    count = len(raw) // 2
    samples = struct.unpack("<" + "h" * count, raw[:count * 2])
    if nch > 1:
        samples = samples[::nch]
    if not samples:
        return None
    acc = 0.0
    for s in samples:
        acc += s * s
    rms = math.sqrt(acc / len(samples)) / 32768.0
    dur = n / float(sr)
    return dur, rms

def is_filler(text):
    t = text.strip()
    if len(t) < 10:
        return True
    compact = re.sub(r"[。．.、，,！!？?…・\s\-—~～]", "", t)
    if len(compact) < 8:
        return True
    if FILLER_RE.match(t):
        return True
    if t.count("ふふ") and len(compact) < 14:
        return True
    return False

def score_clip(dur, rms, text):
    if not (3.0 <= dur <= 12.0):
        return -1.0
    if rms < 0.018 or rms > 0.42:
        return -1.0
    if is_filler(text):
        return -1.0
    dur_score = 1.0 - min(abs(dur - 8.0) / 5.0, 1.0)
    rms_score = min(max((rms - 0.018) / 0.10, 0.0), 1.0)
    text_score = min(len(text) / 48.0, 1.0)
    return 0.42 * dur_score + 0.28 * rms_score + 0.30 * text_score

def list_wavs(folder):
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.iterdir() if p.suffix.lower() == ".wav")

def lookup_text(transcripts, stem):
    return transcripts.get(stem) or transcripts.get(stem.lstrip("0") or "0") or ""

def pick_clip(wavs, transcripts, force_stem):
    if force_stem:
        forced = [p for p in wavs if p.stem == force_stem]
        if forced:
            stats = wav_stats(forced[0])
            text = lookup_text(transcripts, forced[0].stem)
            if stats:
                return forced[0], text, stats[0], stats[1], 99.0
    best = None
    for wav in wavs:
        stats = wav_stats(wav)
        if not stats:
            continue
        dur, rms = stats
        text = lookup_text(transcripts, wav.stem)
        sc = score_clip(dur, rms, text)
        if sc < 0:
            continue
        if best is None or sc > best[4]:
            best = (wav, text, dur, rms, sc)
    if best is None:
        for wav in wavs:
            stats = wav_stats(wav)
            if not stats:
                continue
            dur, rms = stats
            if not (2.5 <= dur <= 13.0):
                continue
            text = lookup_text(transcripts, wav.stem)
            return wav, text, dur, rms, 0.0
        raise RuntimeError("no usable wav in %s" % (wavs[0].parent if wavs else "empty"))
    return best

def main():
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    voices = []
    print("Picking reference clips...")
    fallback = clean_text((DEST_ROOT / "my_voice_ref.txt").read_text(encoding="utf-8"))
    for spec in SPEAKERS:
        if spec["kind"] == "lab":
            base = LAB / spec["name"] / "neutral"
            wav_dir = base / "wavs"
            trans_path = base / "neutral.txt"
        else:
            base = OUTPUT / spec["name"]
            wav_dir = base / "raw"
            trans_path = base / "Neutral.txt"
        wavs = list_wavs(wav_dir)
        if not wavs:
            raise RuntimeError("no wavs for %s in %s" % (spec["id"], wav_dir))
        transcripts = parse_transcripts(trans_path)
        wav, text, dur, rms, sc = pick_clip(wavs, transcripts, spec["forceStem"])
        if not text:
            text = fallback
        out_dir = VOICES_DIR / spec["id"]
        out_dir.mkdir(parents=True, exist_ok=True)
        dest_wav = out_dir / "ref.wav"
        dest_txt = out_dir / "ref.txt"
        shutil.copy2(wav, dest_wav)
        dest_txt.write_text(text + "\n", encoding="utf-8")
        rel_wav = dest_wav.relative_to(PROJ).as_posix()
        voices.append({
            "id": spec["id"],
            "displayName": spec["displayName"],
            "wav": rel_wav,
            "promptText": text,
            "sourceWav": str(wav),
            "durationSec": round(dur, 3),
            "rms": round(rms, 4),
        })
        print("%s  %.2fs  rms=%.3f  score=%.2f  %s  %s" % (spec["id"].ljust(16), dur, rms, sc, wav.name, text[:48]))
    catalog = {
        "defaultId": "my_voice_03",
        "notes": "User-trained clone references for VoxCPM2 (wav+transcript). Not official character voices.",
        "voices": voices,
    }
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Wrote", CATALOG)

if __name__ == "__main__":
    main()