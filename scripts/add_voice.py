import sys, os, json
from pathlib import Path
import soundfile as sf
import numpy as np

# Force UTF-8 encoding on Windows to support Japanese, Korean, and multilingual transcripts
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

def emit_json(obj: dict) -> None:
    text = json.dumps(obj, ensure_ascii=False) + "\n"
    try:
        sys.stdout.write(text)
        sys.stdout.flush()
    except Exception:
        sys.stdout.buffer.write(text.encode("utf-8"))
        sys.stdout.buffer.flush()

def resample(audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    if orig_sr == target_sr:
        return audio
    import scipy.signal
    gcd = np.gcd(orig_sr, target_sr)
    up = target_sr // gcd
    down = orig_sr // gcd
    return scipy.signal.resample_poly(audio, up, down)

def main():
    if len(sys.argv) < 6:
        print(json.dumps({"ok": False, "error": "insufficient arguments"}))
        sys.exit(1)
        
    src_path = sys.argv[1]
    dst_dir = sys.argv[2]
    voice_id = sys.argv[3]
    display_name = sys.argv[4]
    prompt_text = sys.argv[5]
    
    try:
        dst_path = Path(dst_dir)
        dst_path.mkdir(parents=True, exist_ok=True)
        
        data, sr = sf.read(src_path)
        if len(data.shape) > 1 and data.shape[1] > 1:
            data = data.mean(axis=1)
            
        if sr != 48000:
            data = resample(data, sr, 48000)
            sr = 48000
            
        peak = np.abs(data).max()
        if peak > 0:
            data = (data / peak) * 0.95
            
        duration = float(len(data) / sr)
        if duration > 12.0:
            data = data[: 48000 * 10]
            duration = 10.0
            
        out_wav = dst_path / "ref.wav"
        sf.write(str(out_wav), data.astype(np.float32), sr)
        
        out_txt = dst_path / "ref.txt"
        out_txt.write_text(prompt_text, encoding="utf-8")
        
        emit_json({
            "ok": True,
            "id": voice_id,
            "displayName": display_name,
            "wav": f"assets/tts/voices/{voice_id}/ref.wav",
            "promptText": prompt_text,
            "durationSec": round(duration, 2)
        })
    except Exception as e:
        emit_json({"ok": False, "error": str(e)})
        sys.exit(1)

if __name__ == "__main__":
    main()
