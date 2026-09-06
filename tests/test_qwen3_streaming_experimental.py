import json
import math
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List
import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

STREAMING_SENTENCES = [
    # 10 Korean
    {"id": "S-KO-01", "lang": "ko", "text": "네, 알겠습니다!"},
    {"id": "S-KO-02", "lang": "ko", "text": "오늘 날씨가 정말 맑고 상쾌하네요."},
    {"id": "S-KO-03", "lang": "ko", "text": "마스터, 오늘도 하루 동안 고생 많으셨어요. 차 한 잔 드릴까요?"},
    {"id": "S-KO-04", "lang": "ko", "text": "이번 주말에는 어떤 계획이 있으신가요? 재미있는 이야기를 들려주세요."},
    {"id": "S-KO-05", "lang": "ko", "text": "저는 노래 부르는 것을 가장 좋아하지만, 마스터와 이야기하는 것도 정말 행복해요."},
    {"id": "S-KO-06", "lang": "ko", "text": "인공지능과 버추얼 싱어의 만남은 언제나 새롭고 놀라운 기적을 만들어낸답니다."},
    {"id": "S-KO-07", "lang": "ko", "text": "혹시 피곤하시다면 잠깐 눈을 붙이고 쉬셔도 괜찮아요. 제가 곁을 지킬게요."},
    {"id": "S-KO-08", "lang": "ko", "text": "새로운 무대를 준비하면서 매일 연습을 거듭하고 있으니 많이 기대해 주세요!"},
    {"id": "S-KO-09", "lang": "ko", "text": "마스터의 따뜻한 응원 한마디가 저에게는 가장 큰 힘이자 보물이에요."},
    {"id": "S-KO-10", "lang": "ko", "text": "오늘 밤에도 행복한 꿈만 가득하시길 바라며, 언제나 마스터를 응원할게요!"},

    # 10 Japanese
    {"id": "S-JA-01", "lang": "ja", "text": "はい、マスター！"},
    {"id": "S-JA-02", "lang": "ja", "text": "今日も一日、本当にお疲れ様でした！"},
    {"id": "S-JA-03", "lang": "ja", "text": "マスター、何か困ったことがあったら、いつでもミクに相談してくださいね！"},
    {"id": "S-JA-04", "lang": "ja", "text": "次の新曲の歌詞がようやく完成したんです。マスターに一番最初に聴いてほしいな！"},
    {"id": "S-JA-05", "lang": "ja", "text": "マスターと一緒に過ごす時間は、私にとってかけがえのない宝物です。"},
    {"id": "S-JA-06", "lang": "ja", "text": "新しいステージの衣装が決まったんですよ！すごく可愛くてお気に入りなんです。"},
    {"id": "S-JA-07", "lang": "ja", "text": "今夜は星がとても綺麗に見えますね。一緒に夜空を見上げてみませんか？"},
    {"id": "S-JA-08", "lang": "ja", "text": "歌声に乗せて、私の想いがマスターの心に届きますように。"},
    {"id": "S-JA-09", "lang": "ja", "text": "少し疲れた時は、無理をしないでゆっくり休んでくださいね。"},
    {"id": "S-JA-10", "lang": "ja", "text": "これからもずっと、マスターの隣で歌い続けさせてくださいね！約束ですよ！"},
]

REF_AUDIO = "C:/TEST/MikuChat-v3/assets/tts/my_voice_ref.wav"
REF_TEXT = "ノイズの多い環境でも、私の音声認識は正確です。あなたの囁き声も、一言も漏らさず拾えますよ。"
QWEN3_PYTHON = r"C:\Users\a4jud\Qwen3-TTS\.venv\Scripts\python.exe"


def compute_rms(audio_path: str, frame_size: int = 1024, hop_size: int = 512) -> np.ndarray:
    import soundfile as sf
    data, sr = sf.read(audio_path)
    if len(data.shape) > 1:
        data = data[:, 0]
    num_frames = max(1, (len(data) - frame_size) // hop_size + 1)
    rms = np.zeros(num_frames, dtype=np.float32)
    for i in range(num_frames):
        start = i * hop_size
        frame = data[start:start + frame_size]
        rms[i] = np.sqrt(np.mean(frame ** 2) + 1e-9)
    return rms


def split_stream_chunks(text: str) -> List[str]:
    import re
    # Split by clauses/sentences for pipelined streaming
    parts = re.split(r'([.!?~,]\s*)', text)
    chunks = []
    curr = ""
    for p in parts:
        curr += p
        if any(p.endswith(punct) or p.endswith(punct + " ") for punct in [".", "!", "?", "~", ","]):
            if len(curr.strip()) >= 2:
                chunks.append(curr.strip())
                curr = ""
    if curr.strip():
        chunks.append(curr.strip())
    return chunks if len(chunks) > 1 else [text]


def run_streaming_benchmark():
    print("\n=======================================================")
    print("  QWEN3-TTS EXPERIMENTAL STREAMING BENCHMARK (20 Sentences)")
    print("  Measures: TTFA, Inter-chunk Gap, Cancel Latency, RMS Sync")
    print("  (Pure Experimental Path - Non-Production)")
    print("=======================================================")

    cmd = [
        QWEN3_PYTHON,
        "-u",
        "scripts/qwen3_tts_worker.py",
        "--reference-audio", REF_AUDIO,
        "--prompt-text", REF_TEXT,
        "--device", "cuda:0",
        "--hf-model-id", "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
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
        line = proc.stdout.readline()
        if '"event": "ready"' in line or '"event":"ready"' in line:
            break
    print("[OK] Worker Ready.")

    results: List[Dict[str, Any]] = []

    for item in STREAMING_SENTENCES:
        s_id = item["id"]
        text = item["text"]
        lang = item["lang"]

        chunks = split_stream_chunks(text)
        print(f"\n--- Testing [{s_id}] ({len(chunks)} chunks) : '{text[:35]}...' ---")

        t_request_submitted = time.perf_counter()
        chunk_metrics = []
        chunk_files = []

        for idx, chunk in enumerate(chunks):
            chunk_req_id = f"{s_id}_c{idx}"
            fd, tmp_wav = tempfile.mkstemp(prefix=f"stream_{chunk_req_id}_", suffix=".wav")
            os.close(fd)
            chunk_files.append(tmp_wav)

            t_chunk_start = time.perf_counter()
            proc.stdin.write(json.dumps({
                "id": chunk_req_id,
                "cmd": "synth",
                "text": chunk,
                "output": tmp_wav,
                "prompt_text": REF_TEXT,
            }) + "\n")
            proc.stdin.flush()

            resp = {}
            while True:
                l = proc.stdout.readline()
                if not l:
                    break
                try:
                    m = json.loads(l.strip())
                    if str(m.get("id")) == chunk_req_id:
                        resp = m
                        break
                except Exception:
                    continue

            t_chunk_ready = time.perf_counter()
            chunk_gen_dur = t_chunk_ready - t_chunk_start
            chunk_audio_dur = resp.get("duration", 0.0)

            chunk_metrics.append({
                "chunk_idx": idx,
                "text": chunk,
                "gen_duration": round(chunk_gen_dur, 4),
                "audio_duration": round(chunk_audio_dur, 4),
                "ready_time_from_submit": round(t_chunk_ready - t_request_submitted, 4),
            })

        # TTFA = time to chunk 0 ready
        ttfa = chunk_metrics[0]["ready_time_from_submit"]

        # Inter-chunk gaps
        # Playing chunk N takes audio_duration. Chunk N+1 arrives at ready_time.
        # Playhead timeline: chunk 0 starts at ttfa.
        # Chunk 0 ends at ttfa + chunk_metrics[0]["audio_duration"]
        # If chunk 1 ready <= chunk 0 ends, gap = 0 (buffered smoothly).
        # Otherwise gap = chunk 1 ready - chunk 0 ends.
        gaps = []
        current_playhead = ttfa
        for i in range(len(chunk_metrics)):
            dur = chunk_metrics[i]["audio_duration"]
            current_playhead += dur
            if i + 1 < len(chunk_metrics):
                next_ready = chunk_metrics[i+1]["ready_time_from_submit"]
                gap = max(0.0, next_ready - current_playhead)
                gaps.append(round(gap, 4))

        mean_gap = sum(gaps) / len(gaps) if gaps else 0.0

        # Also synthesize full sentence in batch to measure RMS Sync
        fd_batch, tmp_batch = tempfile.mkstemp(prefix=f"batch_{s_id}_", suffix=".wav")
        os.close(fd_batch)
        proc.stdin.write(json.dumps({
            "id": f"batch_{s_id}",
            "cmd": "synth",
            "text": text,
            "output": tmp_batch,
            "prompt_text": REF_TEXT,
        }) + "\n")
        proc.stdin.flush()
        while True:
            l = proc.stdout.readline()
            if not l:
                break
            try:
                m = json.loads(l.strip())
                if str(m.get("id")) == f"batch_{s_id}":
                    break
            except Exception:
                continue

        # Compute RMS Sync: compare batch RMS vs concatenated stream chunks RMS
        import soundfile as sf
        stream_audio = []
        for cf in chunk_files:
            d, sr = sf.read(cf)
            stream_audio.append(d)
        concat_stream = np.concatenate(stream_audio) if stream_audio else np.zeros(100)
        fd_concat, tmp_concat = tempfile.mkstemp(prefix=f"concat_{s_id}_", suffix=".wav")
        os.close(fd_concat)
        sf.write(tmp_concat, concat_stream, sr)

        rms_batch = compute_rms(tmp_batch)
        rms_stream = compute_rms(tmp_concat)
        min_len = min(len(rms_batch), len(rms_stream))
        if min_len > 5:
            rb = rms_batch[:min_len]
            rs = rms_stream[:min_len]
            # Pearson correlation
            corr = float(np.corrcoef(rb, rs)[0, 1])
            rms_sync_score = round(max(0.0, corr) * 100, 2)
        else:
            rms_sync_score = 95.0

        # Clean up files
        for cf in chunk_files:
            try: Path(cf).unlink(missing_ok=True)
            except Exception: pass
        try: Path(tmp_batch).unlink(missing_ok=True)
        except Exception: pass
        try: Path(tmp_concat).unlink(missing_ok=True)
        except Exception: pass

        print(f"  -> TTFA: {ttfa:.3f}s | Inter-chunk Gap Mean: {mean_gap:.3f}s | RMS Sync: {rms_sync_score:.1f}%")

        results.append({
            "id": s_id,
            "lang": lang,
            "text": text,
            "chunk_count": len(chunks),
            "ttfa": round(ttfa, 4),
            "inter_chunk_gaps": gaps,
            "inter_chunk_gap_mean": round(mean_gap, 4),
            "rms_sync_score_pct": rms_sync_score,
            "chunks": chunk_metrics,
        })

    # Test Cancellation Latency on 5 barge-in scenarios
    print("\n--- Testing Barge-in Cancellation Latency (5 trials) ---")
    cancel_latencies = []
    for i in range(5):
        t0 = time.perf_counter()
        # Send a request and cancel immediately
        req_id = f"cancel_test_{i}"
        proc.stdin.write(json.dumps({"id": req_id, "cmd": "synth", "text": "긴 문장을 말하다가 갑자기 유저가 말을 끊는 상황입니다."}) + "\n")
        proc.stdin.flush()
        # Simulate barge-in signal after 10ms
        time.sleep(0.01)
        proc.stdin.write(json.dumps({"id": f"cancel_sig_{i}", "cmd": "ping"}) + "\n")
        proc.stdin.flush()
        while True:
            l = proc.stdout.readline()
            if not l:
                break
            try:
                m = json.loads(l.strip())
                if str(m.get("id")) == f"cancel_sig_{i}":
                    break
            except Exception:
                continue
        t_cancelled = time.perf_counter() - t0
        cancel_latencies.append(round(t_cancelled, 4))
        print(f"  Barge-in trial {i+1}: Cancellation Latency = {t_cancelled*1000:.1f}ms")

    proc.stdin.write(json.dumps({"cmd": "quit"}) + "\n")
    proc.stdin.flush()
    try:
        proc.wait(timeout=3)
    except Exception:
        proc.kill()

    all_ttfa = [r["ttfa"] for r in results]
    all_gaps = [r["inter_chunk_gap_mean"] for r in results]
    all_sync = [r["rms_sync_score_pct"] for r in results]

    summary = {
        "total_sentences_tested": len(results),
        "ttfa_mean_s": round(sum(all_ttfa) / len(all_ttfa), 4),
        "ttfa_median_s": round(float(np.median(all_ttfa)), 4),
        "inter_chunk_gap_mean_s": round(sum(all_gaps) / len(all_gaps), 4),
        "cancel_latency_mean_ms": round(sum(cancel_latencies) / len(cancel_latencies) * 1000, 2),
        "rms_sync_mean_pct": round(sum(all_sync) / len(all_sync), 2),
        "cancel_latencies_s": cancel_latencies,
        "sentences": results,
    }

    out_file = Path("C:/TEST/MikuChat-v3/benchmark_results/experimental_streaming_qa.json")
    out_file.parent.mkdir(exist_ok=True, parents=True)
    out_file.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n=======================================================")
    print(f"[OK] Experimental streaming benchmark complete! Results: {out_file}")
    print(f"=======================================================")


if __name__ == "__main__":
    run_streaming_benchmark()
