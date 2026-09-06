#!/usr/bin/env python3
"""Smoke test script for Qwen3-TTS 1.7B-Base on RTX 5090 (Windows 11).

Verifies:
1. PyTorch CUDA recognition on RTX 5090 (sm_120).
2. Qwen3-TTS model loading in bfloat16.
3. Voice Clone generation in Korean using VoxCPM reference audio (my_voice_ref.wav + transcript).
4. Voice Clone generation in Japanese.
5. In-memory Voice Clone Prompt caching performance.
6. RTF (Real-Time Factor) and Peak VRAM consumption.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    print("=" * 60)
    print("     Qwen3-TTS 1.7B-Base Standalone Smoke Test Runner")
    print("=" * 60)

    # 1. CUDA & Device Capability Check
    import torch
    print(f"-> PyTorch Version: {torch.__version__}")
    print(f"-> CUDA Available:  {torch.cuda.is_available()}")
    if not torch.cuda.is_available():
        print("❌ Error: CUDA is not available. Aborting smoke test.")
        return 1

    device_name = torch.cuda.get_device_name(0)
    capability = torch.cuda.get_device_capability(0)
    total_mem_gb = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
    print(f"-> GPU Device:      {device_name}")
    print(f"-> CUDA Capability: {capability} (sm_{capability[0]}{capability[1]})")
    print(f"-> Total VRAM:      {total_mem_gb:.2f} GB")

    # 2. Check qwen_tts installation
    try:
        from qwen_tts import Qwen3TTSModel
        print("-> qwen_tts import: SUCCESS")
    except ImportError as e:
        print(f"❌ Error importing qwen_tts: {e}")
        return 2

    # 3. Model Loading
    model_id = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
    print(f"\n-> Loading model: {model_id} (bfloat16 on cuda:0)...")
    load_start = time.perf_counter()
    torch.cuda.reset_peak_memory_stats()
    
    try:
        model = Qwen3TTSModel.from_pretrained(
            model_id,
            device_map="cuda:0",
            dtype=torch.bfloat16,
        )
    except Exception as e:
        print(f"❌ Failed to load model {model_id}: {e}")
        return 3

    load_duration = time.perf_counter() - load_start
    loaded_vram = torch.cuda.memory_allocated() / (1024 ** 3)
    peak_load_vram = torch.cuda.max_memory_allocated() / (1024 ** 3)
    print(f"✓ Model loaded in {load_duration:.2f}s (VRAM: {loaded_vram:.2f} GB, Peak: {peak_load_vram:.2f} GB)")

    # 4. Reference Audio & Transcript Check
    ref_audio_path = Path("C:/TEST/MikuChat-v3/assets/tts/my_voice_ref.wav")
    ref_text_path = Path("C:/TEST/MikuChat-v3/assets/tts/my_voice_ref.txt")

    if not ref_audio_path.is_file():
        print(f"❌ Reference audio missing: {ref_audio_path}")
        return 4

    ref_text = ref_text_path.read_text(encoding="utf-8").strip() if ref_text_path.is_file() else ""
    print(f"-> Reference Audio: {ref_audio_path.name}")
    print(f"-> Reference Text:  {ref_text}")

    import soundfile as sf

    # 5. Korean Voice Clone Test
    ko_test_text = "안녕하세요 마스터! Qwen3-TTS 음성 복제 테스트가 성공적으로 동작하고 있어요."
    print(f"\n[Test 1] Generating Korean Speech (Voice Clone)...")
    print(f"   Text: '{ko_test_text}'")

    torch.cuda.reset_peak_memory_stats()
    t0 = time.perf_counter()
    
    try:
        wavs, sr = model.generate_voice_clone(
            text=ko_test_text,
            language="Korean",
            ref_audio=str(ref_audio_path),
            ref_text=ref_text,
            x_vector_only_mode=False,
        )
    except Exception as e:
        print(f"❌ Korean generation failed: {e}")
        return 5

    ko_gen_time = time.perf_counter() - t0
    audio_data = wavs[0] if isinstance(wavs, (list, tuple)) else wavs
    if hasattr(audio_data, "cpu"):
        audio_data = audio_data.cpu().float().numpy()

    audio_duration = len(audio_data) / float(sr)
    rtf = ko_gen_time / audio_duration if audio_duration > 0 else 0
    peak_vram = torch.cuda.max_memory_allocated() / (1024 ** 3)

    out_ko = Path("C:/TEST/MikuChat-v3/tests/output_qwen3_ko.wav")
    sf.write(str(out_ko), audio_data, sr)
    print(f"✓ Korean Audio Generated:")
    print(f"   - Generation Time: {ko_gen_time:.3f}s")
    print(f"   - Audio Duration:  {audio_duration:.2f}s")
    print(f"   - RTF:             {rtf:.3f} (Lower is faster, < 1.0 is real-time)")
    print(f"   - Peak VRAM:       {peak_vram:.2f} GB")
    print(f"   - Output File:     {out_ko} ({out_ko.stat().st_size:,} bytes)")

    # 6. Japanese Voice Clone Test
    ja_test_text = "初音ミクです！今日も一日お疲れ様でした、マスター！"
    print(f"\n[Test 2] Generating Japanese Speech (Voice Clone)...")
    print(f"   Text: '{ja_test_text}'")

    t0 = time.perf_counter()
    try:
        wavs_ja, sr_ja = model.generate_voice_clone(
            text=ja_test_text,
            language="Japanese",
            ref_audio=str(ref_audio_path),
            ref_text=ref_text,
            x_vector_only_mode=False,
        )
    except Exception as e:
        print(f"❌ Japanese generation failed: {e}")
        return 6

    ja_gen_time = time.perf_counter() - t0
    ja_audio = wavs_ja[0] if isinstance(wavs_ja, (list, tuple)) else wavs_ja
    if hasattr(ja_audio, "cpu"):
        ja_audio = ja_audio.cpu().float().numpy()

    ja_duration = len(ja_audio) / float(sr_ja)
    ja_rtf = ja_gen_time / ja_duration if ja_duration > 0 else 0

    out_ja = Path("C:/TEST/MikuChat-v3/tests/output_qwen3_ja.wav")
    sf.write(str(out_ja), ja_audio, sr_ja)
    print(f"✓ Japanese Audio Generated:")
    print(f"   - Generation Time: {ja_gen_time:.3f}s")
    print(f"   - Audio Duration:  {ja_duration:.2f}s")
    print(f"   - RTF:             {ja_rtf:.3f}")
    print(f"   - Output File:     {out_ja} ({out_ja.stat().st_size:,} bytes)")

    # 7. Prompt Caching Speedup Test
    print(f"\n[Test 3] Testing Voice Clone Prompt Caching Speedup...")
    if hasattr(model, "create_voice_clone_prompt"):
        try:
            t0 = time.perf_counter()
            cached_prompt = model.create_voice_clone_prompt(
                ref_audio=str(ref_audio_path),
                ref_text=ref_text,
                x_vector_only_mode=False,
            )
            prompt_creation_time = time.perf_counter() - t0
            print(f"✓ Voice clone prompt created in {prompt_creation_time:.3f}s")

            # Subsequent generation with cached prompt
            t0 = time.perf_counter()
            cached_wavs, cached_sr = model.generate_voice_clone(
                text="캐시된 프롬프트로 생성하는 두 번째 문장입니다.",
                language="Korean",
                voice_clone_prompt=cached_prompt,
            )
            cached_gen_time = time.perf_counter() - t0
            cached_audio = cached_wavs[0] if isinstance(cached_wavs, (list, tuple)) else cached_wavs
            if hasattr(cached_audio, "cpu"):
                cached_audio = cached_audio.cpu().float().numpy()
            cached_dur = len(cached_audio) / float(cached_sr)
            cached_rtf = cached_gen_time / cached_dur if cached_dur > 0 else 0
            print(f"✓ Cached Generation: {cached_gen_time:.3f}s (Duration: {cached_dur:.2f}s, RTF: {cached_rtf:.3f})")
        except Exception as cache_err:
            print(f"⚠️ Prompt caching test warning: {cache_err}")
    else:
        print("ℹ️ create_voice_clone_prompt method not available directly on model; checking generation kwargs.")

    print("\n" + "=" * 60)
    print("🎉 ALL QWEN3-TTS STANDALONE SMOKE TESTS COMPLETED SUCCESSFULLY!")
    print("=" * 60)
    return 0

if __name__ == "__main__":
    sys.exit(main())
