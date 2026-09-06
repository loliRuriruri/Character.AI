import json
import math
import os
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BENCHMARK_SENTENCES = [
    {"id": "KO-1", "lang": "ko", "type": "Short", "text": "네, 마스터!"},
    {"id": "KO-2", "lang": "ko", "type": "Short-Med", "text": "오늘 날씨가 정말 화창하고 기분 좋네요!"},
    {"id": "KO-3", "lang": "ko", "type": "Medium", "text": "마스터, 오늘도 하루 동안 수고 많으셨어요. 제가 신나는 노래 하나 불러드릴까요?"},
    {"id": "KO-4", "lang": "ko", "type": "Med-Long", "text": "다음 주 라이브 콘서트 준비를 위해 새로운 안무와 노래를 열심히 연습하고 있답니다. 기대해 주세요!"},
    {"id": "KO-5", "lang": "ko", "type": "Long (RP)", "text": "우와, 마스터가 그렇게 칭찬해 주시니까 조금 쑥스럽지만 정말 기뻐요! 내일도 우리 함께 멋진 하루를 만들어가요!"},
    {"id": "JA-1", "lang": "ja", "type": "Short", "text": "はい、マスター！"},
    {"id": "JA-2", "lang": "ja", "type": "Short-Med", "text": "今日も一日、本当にお疲れ様でした！"},
    {"id": "JA-3", "lang": "ja", "type": "Medium", "text": "マスター、何か困ったことがあったら、いつでもミクに相談してくださいね！"},
    {"id": "JA-4", "lang": "ja", "type": "Med-Long", "text": "次の新曲の歌詞がようやく完成したんです。マスターに一番最初に聴いてほしいな！"},
    {"id": "JA-5", "lang": "ja", "type": "Long (RP)", "text": "マスターと一緒に過ごす時間は、私にとってかけがえのない宝物です。これからもずっと、隣で歌い続けさせてくださいね！"},
]

REF_AUDIO = "C:/TEST/MikuChat-v3/assets/tts/my_voice_ref.wav"
REF_TEXT = "ノイズの多い環境でも、私の音声認識は正確です。あなたの囁き声も、一言も漏らさず拾えますよ。"

VOXCPM_PYTHON = r"C:\Users\a4jud\VoxCPM\.venv\Scripts\python.exe"
QWEN3_PYTHON = r"C:\Users\a4jud\Qwen3-TTS\.venv\Scripts\python.exe"


def percentile_95(values: List[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * 0.95
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return s[int(k)]
    d0 = s[int(f)] * (c - k)
    d1 = s[int(c)] * (k - f)
    return d0 + d1


def median(values: List[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2 == 1:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2.0


def run_model_5_iterations(
    model_name: str,
    python_exe: str,
    worker_script: str,
    extra_args: List[str],
    iterations: int = 5,
) -> Dict[str, Any]:
    print(f"\n=======================================================")
    print(f"  BENCHMARK: {model_name} (5 iterations per sentence)")
    print(f"  Worker: {worker_script} {' '.join(extra_args)}")
    print(f"=======================================================")

    cmd = [python_exe, "-u", worker_script, "--reference-audio", REF_AUDIO] + extra_args
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
    )

    ready_msg = {}
    while True:
        line = proc.stdout.readline()
        if not line:
            break
        try:
            m = json.loads(line.strip())
            if m.get("event") == "ready":
                ready_msg = m
                break
        except Exception:
            continue

    sample_rate = ready_msg.get("sample_rate", 24000)
    print(f"✓ Worker Ready (SR: {sample_rate}Hz, Device: {ready_msg.get('device')})")

    # Global Warmup
    print("-> Executing Global Warmup (excluded from statistics)...")
    proc.stdin.write(json.dumps({
        "id": "warmup_global",
        "cmd": "synth",
        "text": "안녕하세요, 테스트 웜업입니다.",
        "prompt_text": REF_TEXT,
    }) + "\n")
    proc.stdin.flush()
    while True:
        line = proc.stdout.readline()
        if not line:
            break
        try:
            m = json.loads(line.strip())
            if m.get("id") == "warmup_global":
                break
        except Exception:
            continue
    print("✓ Global Warmup Complete.\n")

    raw_rows: List[Dict[str, Any]] = []

    for item in BENCHMARK_SENTENCES:
        s_id = item["id"]
        s_lang = item["lang"]
        s_type = item["type"]
        s_text = item["text"]

        print(f"--- Running {s_id} [{s_type}] ({s_lang.upper()}): {s_text[:30]}... ---")

        for run_idx in range(1, iterations + 1):
            req_id = f"{s_id}_run{run_idx}"
            t_submitted = time.perf_counter()

            proc.stdin.write(json.dumps({
                "id": req_id,
                "cmd": "synth",
                "text": s_text,
                "prompt_text": REF_TEXT,
            }) + "\n")
            proc.stdin.flush()

            resp = {}
            while True:
                line = proc.stdout.readline()
                if not line:
                    break
                try:
                    m = json.loads(line.strip())
                    if str(m.get("id")) == req_id:
                        resp = m
                        break
                except Exception:
                    continue

            t_playable = time.perf_counter()
            ttfa = t_playable - t_submitted
            wall_time = ttfa
            audio_duration = resp.get("duration", 0.0)
            rtf = (wall_time / audio_duration) if audio_duration > 0 else 0.0

            row = {
                "model": model_name,
                "sentence_id": s_id,
                "lang": s_lang,
                "type": s_type,
                "iteration": run_idx,
                "text": s_text,
                "request_submitted_at": round(t_submitted, 4),
                "first_playable_at": round(t_playable, 4),
                "ttfa": round(ttfa, 4),
                "wall_time": round(wall_time, 4),
                "audio_duration": round(audio_duration, 4),
                "rtf": round(rtf, 4),
                "sample_rate": sample_rate,
                "ok": resp.get("ok", False),
            }
            raw_rows.append(row)
            print(f"  Run {run_idx}: TTFA={ttfa:.3f}s, Audio={audio_duration:.2f}s, RTF={rtf:.3f}")

    try:
        proc.stdin.write(json.dumps({"cmd": "quit"}) + "\n")
        proc.stdin.flush()
        proc.wait(timeout=3)
    except Exception:
        proc.kill()

    sentence_stats = []
    for item in BENCHMARK_SENTENCES:
        s_id = item["id"]
        rows = [r for r in raw_rows if r["sentence_id"] == s_id]
        ttfas = [r["ttfa"] for r in rows]
        durations = [r["audio_duration"] for r in rows]
        rtfs = [r["rtf"] for r in rows]

        sentence_stats.append({
            "sentence_id": s_id,
            "lang": item["lang"],
            "type": item["type"],
            "text": item["text"],
            "runs": len(rows),
            "ttfa_mean": round(sum(ttfas) / len(ttfas), 4),
            "ttfa_median": round(median(ttfas), 4),
            "ttfa_p95": round(percentile_95(ttfas), 4),
            "audio_dur_mean": round(sum(durations) / len(durations), 4),
            "rtf_mean": round(sum(rtfs) / len(rtfs), 4),
            "rtf_median": round(median(rtfs), 4),
            "rtf_p95": round(percentile_95(rtfs), 4),
        })

    all_ttfa = [r["ttfa"] for r in raw_rows]
    all_rtf = [r["rtf"] for r in raw_rows]
    all_dur = [r["audio_duration"] for r in raw_rows]

    overall_stats = {
        "model": model_name,
        "sample_rate": sample_rate,
        "total_runs": len(raw_rows),
        "overall_ttfa_mean": round(sum(all_ttfa) / len(all_ttfa), 4),
        "overall_ttfa_median": round(median(all_ttfa), 4),
        "overall_ttfa_p95": round(percentile_95(all_ttfa), 4),
        "overall_rtf_mean": round(sum(all_rtf) / len(all_rtf), 4),
        "overall_rtf_median": round(median(all_rtf), 4),
        "overall_rtf_p95": round(percentile_95(all_rtf), 4),
        "total_audio_synthesized": round(sum(all_dur), 2),
    }

    return {
        "model": model_name,
        "overall": overall_stats,
        "sentence_stats": sentence_stats,
        "raw_rows": raw_rows,
    }


def run_ollama_contention_benchmark() -> Dict[str, Any]:
    print("\n=======================================================")
    print("  OLLAMA (gemma4:12b) CONCURRENT CONTENTION BENCHMARK")
    print("=======================================================")

    prompt = "Write a comprehensive 250-word essay about the history and future of artificial intelligence in music."
    url = "http://127.0.0.1:11434/api/generate"

    def query_ollama() -> Dict[str, Any]:
        payload = json.dumps({
            "model": "gemma4:12b",
            "prompt": prompt,
            "stream": False,
            "options": {"num_predict": 180},
        }).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        t0 = time.perf_counter()
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        wall = time.perf_counter() - t0
        eval_count = data.get("eval_count", 0)
        eval_dur_s = (data.get("eval_duration", 0) / 1e9)
        tok_per_sec = (eval_count / eval_dur_s) if eval_dur_s > 0 else 0.0
        return {
            "wall_time": round(wall, 3),
            "eval_count": eval_count,
            "eval_duration_s": round(eval_dur_s, 3),
            "tokens_per_sec": round(tok_per_sec, 2),
        }

    print("-> Warming up Ollama gemma4:12b...")
    query_ollama()
    print("✓ Warmup complete.")

    print("-> Measuring Baseline Ollama generation speed...")
    base_results = [query_ollama() for _ in range(3)]
    base_tps = sum(r["tokens_per_sec"] for r in base_results) / len(base_results)
    print(f"✓ Baseline Ollama speed: {base_tps:.2f} tokens/sec")

    test_sentence = "다음 주 라이브 콘서트 준비를 위해 새로운 안무와 노래를 열심히 연습하고 있답니다. 기대해 주세요!"

    def benchmark_with_tts(
        name: str,
        python_exe: str,
        worker_script: str,
        extra_args: List[str],
    ) -> Dict[str, Any]:
        print(f"\n--- Testing Concurrent Contention with {name} ---")
        cmd = [python_exe, "-u", worker_script, "--reference-audio", REF_AUDIO] + extra_args
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
        )
        while True:
            l = proc.stdout.readline()
            if '"event": "ready"' in l or '"event":"ready"' in l:
                break

        t0 = time.perf_counter()
        proc.stdin.write(json.dumps({"id": "tts_base", "cmd": "synth", "text": test_sentence, "prompt_text": REF_TEXT}) + "\n")
        proc.stdin.flush()
        while True:
            l = proc.stdout.readline()
            if '"id": "tts_base"' in l or '"id":"tts_base"' in l:
                break
        tts_base_time = time.perf_counter() - t0
        print(f"  {name} Baseline Synthesis Time (idle): {tts_base_time:.3f}s")

        ollama_res: Dict[str, Any] = {}
        ollama_err = None

        def run_ollama():
            nonlocal ollama_res, ollama_err
            try:
                ollama_res = query_ollama()
            except Exception as e:
                ollama_err = str(e)

        t_llm = threading.Thread(target=run_ollama)
        t_llm.start()
        time.sleep(0.5)

        t0 = time.perf_counter()
        proc.stdin.write(json.dumps({"id": "tts_concurrent", "cmd": "synth", "text": test_sentence, "prompt_text": REF_TEXT}) + "\n")
        proc.stdin.flush()
        while True:
            l = proc.stdout.readline()
            if '"id": "tts_concurrent"' in l or '"id":"tts_concurrent"' in l:
                break
        tts_concurrent_time = time.perf_counter() - t0
        print(f"  {name} Concurrent Synthesis Time (contention): {tts_concurrent_time:.3f}s")

        t_llm.join(timeout=60)
        concurrent_tps = ollama_res.get("tokens_per_sec", 0.0)
        print(f"  Ollama Tokens/Sec during {name}: {concurrent_tps:.2f} tps")

        proc.stdin.write(json.dumps({"cmd": "quit"}) + "\n")
        proc.stdin.flush()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()

        tps_reduction_pct = ((base_tps - concurrent_tps) / base_tps * 100.0) if base_tps > 0 else 0.0
        tts_slowdown_pct = ((tts_concurrent_time - tts_base_time) / tts_base_time * 100.0) if tts_base_time > 0 else 0.0

        return {
            "provider": name,
            "tts_baseline_wall_s": round(tts_base_time, 3),
            "tts_concurrent_wall_s": round(tts_concurrent_time, 3),
            "tts_slowdown_pct": round(tts_slowdown_pct, 1),
            "ollama_baseline_tps": round(base_tps, 2),
            "ollama_concurrent_tps": round(concurrent_tps, 2),
            "ollama_tps_reduction_pct": round(tps_reduction_pct, 1),
        }

    voxcpm_contention = benchmark_with_tts(
        "VoxCPM2",
        VOXCPM_PYTHON,
        "scripts/voxcpm_worker.py",
        ["--device", "cuda"],
    )

    qwen_1_7b_contention = benchmark_with_tts(
        "Qwen3-TTS 1.7B",
        QWEN3_PYTHON,
        "scripts/qwen3_tts_worker.py",
        ["--device", "cuda:0", "--hf-model-id", "Qwen/Qwen3-TTS-12Hz-1.7B-Base"],
    )

    qwen_0_6b_contention = benchmark_with_tts(
        "Qwen3-TTS 0.6B",
        QWEN3_PYTHON,
        "scripts/qwen3_tts_worker.py",
        ["--device", "cuda:0", "--hf-model-id", "Qwen/Qwen3-TTS-12Hz-0.6B-Base"],
    )

    return {
        "ollama_baseline_tps": round(base_tps, 2),
        "comparisons": [voxcpm_contention, qwen_1_7b_contention, qwen_0_6b_contention],
    }


def test_qwen_cache_invalidation() -> Dict[str, Any]:
    print("\n=======================================================")
    print("  QWEN PROMPT CACHE INVALIDATION TEST")
    print("=======================================================")
    cmd = [
        QWEN3_PYTHON,
        "-u",
        "scripts/qwen3_tts_worker.py",
        "--reference-audio", REF_AUDIO,
        "--prompt-text", REF_TEXT,
        "--device", "cuda:0",
    ]
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
    )
    while True:
        l = proc.stdout.readline()
        if '"event": "ready"' in l or '"event":"ready"' in l:
            break

    def test_prompt(req_id: str, audio: str, text: str) -> Dict[str, Any]:
        t0 = time.perf_counter()
        proc.stdin.write(json.dumps({
            "id": req_id,
            "cmd": "create_prompt",
            "reference_wav": audio,
            "prompt_text": text,
        }) + "\n")
        proc.stdin.flush()
        resp = {}
        while True:
            l = proc.stdout.readline()
            if not l:
                break
            try:
                m = json.loads(l.strip())
                if str(m.get("id")) == req_id:
                    resp = m
                    break
            except Exception:
                continue
        dur = time.perf_counter() - t0
        return {"id": req_id, "duration": round(dur, 4), "ok": resp.get("ok", False)}

    r1 = test_prompt("hit_check", REF_AUDIO, REF_TEXT)
    r2 = test_prompt("transcript_changed", REF_AUDIO, "異なるプロンプトテキストでキャッシュ無効化をテストします。")
    r3 = test_prompt("transcript_cached", REF_AUDIO, "異なるプロンプトテキストでキャッシュ無効化をテストします。")
    temp_wav = Path(REF_AUDIO).parent / "temp_ref_copy.wav"
    import shutil
    shutil.copyfile(REF_AUDIO, temp_wav)
    r4 = test_prompt("audio_changed", str(temp_wav), REF_TEXT)
    try:
        temp_wav.unlink(missing_ok=True)
    except Exception:
        pass

    proc.stdin.write(json.dumps({"cmd": "quit"}) + "\n")
    proc.stdin.flush()
    try:
        proc.wait(timeout=3)
    except Exception:
        proc.kill()

    results = {
        "prewarmed_cache_hit_s": r1["duration"],
        "transcript_change_rebuild_s": r2["duration"],
        "transcript_second_call_cached_s": r3["duration"],
        "audio_path_change_rebuild_s": r4["duration"],
        "invalidation_verified": (r2["duration"] > 0.05 and r3["duration"] < 0.01),
    }
    print(f"✓ Cache Results: Prewarmed={r1['duration']}s, RebuiltOnTextChange={r2['duration']}s, CachedOnRepeat={r3['duration']}s, RebuiltOnAudioChange={r4['duration']}s")
    print(f"✓ Invalidation Logic Verified: {results['invalidation_verified']}")
    return results


def main() -> int:
    output_dir = Path("C:/TEST/MikuChat-v3/benchmark_results")
    output_dir.mkdir(exist_ok=True, parents=True)

    print(">>> Phase 1: 5-Iteration Benchmarks on VoxCPM2, Qwen 1.7B, Qwen 0.6B <<<")
    res_voxcpm = run_model_5_iterations(
        "VoxCPM2",
        VOXCPM_PYTHON,
        "scripts/voxcpm_worker.py",
        ["--device", "cuda"],
        iterations=5,
    )

    res_qwen17 = run_model_5_iterations(
        "Qwen3-TTS 1.7B-Base",
        QWEN3_PYTHON,
        "scripts/qwen3_tts_worker.py",
        ["--device", "cuda:0", "--hf-model-id", "Qwen/Qwen3-TTS-12Hz-1.7B-Base"],
        iterations=5,
    )

    res_qwen06 = run_model_5_iterations(
        "Qwen3-TTS 0.6B-Base",
        QWEN3_PYTHON,
        "scripts/qwen3_tts_worker.py",
        ["--device", "cuda:0", "--hf-model-id", "Qwen/Qwen3-TTS-12Hz-0.6B-Base"],
        iterations=5,
    )

    print("\n>>> Phase 2: Ollama Concurrent Contention Benchmark <<<")
    res_ollama = run_ollama_contention_benchmark()

    print("\n>>> Phase 3: Prompt Cache Invalidation Test <<<")
    res_cache = test_qwen_cache_invalidation()

    final_payload = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "hardware": {
            "gpu": "NVIDIA GeForce RTX 5090 (32GB, sm_120)",
            "os": "Windows 11",
            "torch_voxcpm": "2.6.0+cu124",
            "torch_qwen3": "2.11.0+cu128",
        },
        "voxcpm2": res_voxcpm,
        "qwen3_1_7b": res_qwen17,
        "qwen3_0_6b": res_qwen06,
        "ollama_contention": res_ollama,
        "cache_invalidation": res_cache,
    }

    out_file = output_dir / "closeout_qa_benchmark.json"
    out_file.write_text(json.dumps(final_payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n=======================================================")
    print(f"✓ All benchmarks complete! Saved results to {out_file}")
    print(f"=======================================================")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
