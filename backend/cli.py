"""
Audio2MIDI Studio - Backend CLI Dispatcher
Executes AMT tasks as a decoupled worker process.
"""

import os
import sys
import json
import time
import argparse
from typing import Dict, Any

from backend.engine import (
    AudioInspector,
    AudioPreprocessor,
    NotePostProcessor,
    MidiWriterAndVerifier,
    CandidateExplorer,
    MODEL_VERSION,
    MODEL_SHA256,
    TARGET_SAMPLE_RATE
)
from basic_pitch.inference import predict


def cmd_analyze(args):
    result = AudioInspector.inspect(args.audio)
    print(json.dumps(result, ensure_ascii=False))


def cmd_transcribe(args):
    params = json.loads(args.params) if args.params else {}
    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)

    start_time_all = time.time()
    t_inspect = time.time()
    inspect_data = AudioInspector.inspect(args.audio)
    time_inspect = time.time() - t_inspect

    # 1. Preprocessing
    t_prep = time.time()
    preprocessed_wav = os.path.join(out_dir, "preprocessed.wav")
    prep_res = AudioPreprocessor.process(
        input_path=args.audio,
        output_path=preprocessed_wav,
        normalize_volume=params.get("normalize_volume", True),
        high_pass_hz=params.get("high_pass_hz", None),
        low_pass_hz=params.get("low_pass_hz", None),
        noise_gate_db=params.get("noise_gate_db", None),
        start_sec=params.get("start_sec", None),
        end_sec=params.get("end_sec", None)
    )
    time_prep = time.time() - t_prep

    # 2. Model Inference
    t_infer = time.time()
    onset_threshold = float(params.get("onset_threshold", 0.50))
    frame_threshold = float(params.get("frame_threshold", 0.30))
    min_note_len_ms = int(params.get("min_note_len_ms", 58))

    model_output, raw_midi, note_events = predict(
        preprocessed_wav,
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
        minimum_note_length=min_note_len_ms,
        melodia_trick=params.get("melodia_trick", True)
    )
    time_infer = time.time() - t_infer

    # Raw notes (no post-filtering)
    raw_notes = []
    for idx, n in enumerate(note_events):
        p = int(round(n[2]))
        raw_notes.append({
            "id": f"raw_{idx+1}",
            "pitch": p,
            "start": round(float(n[0]), 4),
            "end": round(float(n[1]), 4),
            "duration": round(float(n[1]) - float(n[0]), 4),
            "velocity": int(round(float(n[3]) * 127))
        })

    # Save raw transcribed MIDI
    raw_midi_path = os.path.join(out_dir, "transcription_raw.mid")
    raw_midi.write(raw_midi_path)

    # 3. Post-Processing
    t_post = time.time()
    post_notes = NotePostProcessor.process_notes(
        note_events=note_events,
        params=params,
        non_silent_intervals=inspect_data.get("non_silent_intervals", [])
    )
    time_post = time.time() - t_post

    # 4. Generate Postprocessed MIDI
    bpm = float(params.get("manual_bpm") or inspect_data.get("estimated_bpm") or 120.0)
    post_midi_path = os.path.join(out_dir, "transcription_postprocessed.mid")
    verification = MidiWriterAndVerifier.create_midi(
        notes=post_notes,
        output_path=post_midi_path,
        bpm=bpm
    )

    # 5. Export Note Events CSV
    csv_path = os.path.join(out_dir, "notes.csv")
    with open(csv_path, "w", encoding="utf-8") as f:
        f.write("id,pitch,pitch_name,start_seconds,end_seconds,duration_seconds,velocity\n")
        for n in post_notes:
            f.write(f"{n['id']},{n['pitch']},{n['pitch_name']},{n['start']},{n['end']},{n['duration']},{n['velocity']}\n")

    # 6. Conversion Report
    total_time = time.time() - start_time_all
    report = {
        "engine": "Audio2MIDI Studio AMT Pipeline",
        "model_version": MODEL_VERSION,
        "model_sha256": MODEL_SHA256,
        "input_file": os.path.basename(args.audio),
        "input_sha256": inspect_data["sha256"],
        "duration_seconds": inspect_data["duration_seconds"],
        "applied_params": params,
        "timing_breakdown": {
            "inspection_sec": round(time_inspect, 2),
            "preprocessing_sec": round(time_prep, 2),
            "inference_sec": round(time_infer, 2),
            "postprocessing_sec": round(time_post, 2),
            "total_sec": round(total_time, 2)
        },
        "raw_note_count": len(raw_notes),
        "post_note_count": len(post_notes),
        "pruned_notes": len(raw_notes) - len(post_notes),
        "midi_verification": verification,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    report_path = os.path.join(out_dir, "conversion_report.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    # Output response
    response = {
        "status": "success",
        "inspection": inspect_data,
        "preprocessing": prep_res,
        "raw_note_count": len(raw_notes),
        "note_count": len(post_notes),
        "notes": post_notes,
        "raw_notes_sample": raw_notes[:20],
        "verification": verification,
        "report": report,
        "files": {
            "raw_midi": raw_midi_path,
            "post_midi": post_midi_path,
            "notes_csv": csv_path,
            "report_json": report_path
        }
    }
    print(json.dumps(response, ensure_ascii=False))


def cmd_compare(args):
    res = CandidateExplorer.explore(
        audio_path=args.audio,
        start_sec=args.start,
        end_sec=args.end,
        mode=args.mode,
        work_dir=args.out_dir
    )
    print(json.dumps(res, ensure_ascii=False))


def cmd_benchmark(args):
    from backend.test_suite import TestSuiteRunner
    res = TestSuiteRunner.run_benchmark(output_dir=args.out_dir)
    print(json.dumps(res, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description="Audio2MIDI CLI Engine")
    subparsers = parser.add_subparsers(dest="command")

    p_analyze = subparsers.add_parser("analyze")
    p_analyze.add_argument("--audio", required=True)

    p_transcribe = subparsers.add_parser("transcribe")
    p_transcribe.add_argument("--audio", required=True)
    p_transcribe.add_argument("--params", default="{}")
    p_transcribe.add_argument("--out-dir", required=True)

    p_compare = subparsers.add_parser("compare")
    p_compare.add_argument("--audio", required=True)
    p_compare.add_argument("--start", type=float, required=True)
    p_compare.add_argument("--end", type=float, required=True)
    p_compare.add_argument("--mode", default="balanced")
    p_compare.add_argument("--out-dir", required=True)

    p_bench = subparsers.add_parser("benchmark")
    p_bench.add_argument("--out-dir", required=True)

    args = parser.parse_args()
    if args.command == "analyze":
        cmd_analyze(args)
    elif args.command == "transcribe":
        cmd_transcribe(args)
    elif args.command == "compare":
        cmd_compare(args)
    elif args.command == "benchmark":
        cmd_benchmark(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
