import subprocess
import json
import sys
import time

def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print("Testing Qwen3-TTS Worker IPC...")
    cmd = [
        r"C:\Users\a4jud\Qwen3-TTS\.venv\Scripts\python.exe",
        "-u",
        r"scripts\qwen3_tts_worker.py",
        "--reference-audio", r"assets\tts\my_voice_ref.wav",
        "--device", "cuda:0"
    ]
    p = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    print("Process spawned, reading ready line...")
    ready_line = p.stdout.readline().strip()
    print("READY LINE:", ready_line)
    
    print("Sending ping...")
    p.stdin.write(json.dumps({"id": "p1", "cmd": "ping"}) + "\n")
    p.stdin.flush()
    pong = p.stdout.readline().strip()
    print("PONG:", pong)

    print("Sending synth...")
    t0 = time.perf_counter()
    p.stdin.write(json.dumps({"id": "s1", "cmd": "synth", "text": "안녕하세요! 워커 테스트입니다."}) + "\n")
    p.stdin.flush()
    synth_res = p.stdout.readline().strip()
    print(f"SYNTH RESULT ({time.perf_counter() - t0:.2f}s):", synth_res)

    print("Sending quit...")
    p.stdin.write(json.dumps({"cmd": "quit"}) + "\n")
    p.stdin.flush()
    p.wait(timeout=5)
    print("Worker exited cleanly.")

if __name__ == "__main__":
    main()
