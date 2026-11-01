"""
Audio2MIDI Studio - Automated AMT Test Suite & Ground Truth Benchmark
Implements Specification 11:
- Ground-truth synthesis test sets (Scales, Repeated Notes, Chords, Registers, Rests, Dynamics)
- Standard MIR evaluation metrics:
    * Pitch + Onset Precision, Recall, F1 (onset tolerance 50ms)
    * Onset + Offset F1 (offset tolerance max(50ms, 0.20 * duration))
    * Mean Absolute Onset Error (ms)
    * Silence false positives
    * Roundtrip MIDI file serialization validation
"""

import os
import sys
import time
import json
import tempfile
from typing import Dict, List, Tuple, Any, Optional, Set

import numpy as np
import soundfile as sf
import pretty_midi

from backend.engine import (
    AudioInspector,
    NotePostProcessor,
    MidiWriterAndVerifier,
    MODEL_VERSION,
    MODEL_SHA256,
    TARGET_SAMPLE_RATE
)
from basic_pitch.inference import predict


class AudioSynthesizer:
    """Synthesizes high-fidelity acoustic waveforms with exact known ground truth note events."""

    @staticmethod
    def synthesize_notes(
        notes: List[Dict[str, Any]],
        sample_rate: int = TARGET_SAMPLE_RATE,
        timbre: str = "piano"
    ) -> np.ndarray:
        """
        Synthesizes notes using additive harmonic synthesis with natural ADSR envelope.
        """
        if not notes:
            return np.zeros(sample_rate, dtype=np.float32)

        max_time = max(n["end"] for n in notes) + 0.5
        total_samples = int(math_ceil(max_time * sample_rate))
        buffer = np.zeros(total_samples, dtype=np.float32)

        for n in notes:
            pitch = n["pitch"]
            freq = 440.0 * (2.0 ** ((pitch - 69) / 12.0))
            start_sample = int(n["start"] * sample_rate)
            dur_samples = int((n["end"] - n["start"]) * sample_rate)
            velocity = n.get("velocity", 80) / 127.0

            if dur_samples <= 0 or start_sample >= total_samples:
                continue

            t = np.linspace(0, (n["end"] - n["start"]), dur_samples, endpoint=False)

            # Harmonics (fundamental + 2nd, 3rd, 4th harmonic)
            wave = (
                1.00 * np.sin(2 * np.pi * freq * t) +
                0.40 * np.sin(2 * np.pi * (2 * freq) * t) +
                0.20 * np.sin(2 * np.pi * (3 * freq) * t) +
                0.10 * np.sin(2 * np.pi * (4 * freq) * t)
            )

            # ADSR Envelope
            attack_s = min(0.015, (n["end"] - n["start"]) * 0.1)
            attack_n = int(attack_s * sample_rate)
            decay_n = int(dur_samples * 0.4)
            release_n = int(min(0.03, (n["end"] - n["start"]) * 0.2) * sample_rate)

            env = np.ones(dur_samples, dtype=np.float32)
            if attack_n > 0:
                env[:attack_n] = np.linspace(0, 1.0, attack_n)
            # Exponential decay
            decay_curve = np.exp(-1.5 * np.linspace(0, 1, dur_samples))
            env = env * decay_curve
            if release_n > 0 and dur_samples > release_n:
                env[-release_n:] *= np.linspace(1.0, 0, release_n)

            note_audio = wave * env * velocity
            end_sample = min(total_samples, start_sample + dur_samples)
            actual_len = end_sample - start_sample
            buffer[start_sample:end_sample] += note_audio[:actual_len]

        # Normalize to prevent clipping
        peak = np.max(np.abs(buffer))
        if peak > 0:
            buffer = (buffer / peak) * 0.88

        return buffer


def math_ceil(val: float) -> int:
    return int(np.ceil(val))


class AMTEvaluator:
    """Evaluates estimated note events against ground-truth note events."""

    @staticmethod
    def match_notes(
        ground_truth: List[Dict[str, Any]],
        estimated: List[Dict[str, Any]],
        onset_tolerance_sec: float = 0.050,  # 50ms standard
        offset_ratio: float = 0.20          # 20% or 50ms whichever is larger
    ) -> Dict[str, Any]:
        """
        Bipartite one-to-one matching between ground truth and estimated notes.
        """
        gt_used = set()
        est_used = set()

        tp_onset = 0
        tp_offset = 0
        onset_errors = []

        # Sort estimated notes by start time
        sorted_est_indices = sorted(range(len(estimated)), key=lambda i: estimated[i]["start"])

        for est_idx in sorted_est_indices:
            est = estimated[est_idx]
            best_gt_idx = None
            best_onset_err = float('inf')

            for gt_idx, gt in enumerate(ground_truth):
                if gt_idx in gt_used:
                    continue
                # Same pitch required
                if gt["pitch"] != est["pitch"]:
                    continue

                onset_err = abs(gt["start"] - est["start"])
                if onset_err <= onset_tolerance_sec:
                    if onset_err < best_onset_err:
                        best_onset_err = onset_err
                        best_gt_idx = gt_idx

            if best_gt_idx is not None:
                gt_used.add(best_gt_idx)
                est_used.add(est_idx)
                tp_onset += 1
                onset_errors.append(best_onset_err)

                # Check offset tolerance: max(50ms, 20% of duration)
                gt = ground_truth[best_gt_idx]
                gt_dur = gt["end"] - gt["start"]
                offset_tol = max(0.050, gt_dur * offset_ratio)
                if abs(gt["end"] - est["end"]) <= offset_tol:
                    tp_offset += 1

        total_gt = len(ground_truth)
        total_est = len(estimated)

        # Onset Precision, Recall, F1
        p_onset = tp_onset / total_est if total_est > 0 else 0.0
        r_onset = tp_onset / total_gt if total_gt > 0 else 0.0
        f1_onset = (2 * p_onset * r_onset) / (p_onset + r_onset) if (p_onset + r_onset) > 0 else 0.0

        # Offset F1
        p_offset = tp_offset / total_est if total_est > 0 else 0.0
        r_offset = tp_offset / total_gt if total_gt > 0 else 0.0
        f1_offset = (2 * p_offset * r_offset) / (p_offset + r_offset) if (p_offset + r_offset) > 0 else 0.0

        mean_onset_err_ms = float(np.mean(onset_errors) * 1000.0) if onset_errors else 0.0

        return {
            "ground_truth_count": total_gt,
            "estimated_count": total_est,
            "true_positives_onset": tp_onset,
            "true_positives_offset": tp_offset,
            "precision_onset": round(p_onset, 4),
            "recall_onset": round(r_onset, 4),
            "f1_onset": round(f1_onset, 4),
            "precision_offset": round(p_offset, 4),
            "recall_offset": round(r_offset, 4),
            "f1_offset": round(f1_offset, 4),
            "mean_onset_error_ms": round(mean_onset_err_ms, 2),
            "false_positives": total_est - tp_onset,
            "false_negatives": total_gt - tp_onset
        }


class TestSuiteRunner:
    """Generates synthetic test sets and runs full verification benchmark."""

    @staticmethod
    def get_test_suites() -> Dict[str, List[Dict[str, Any]]]:
        """Defines all test cases required by Specification 11."""
        suites = {}

        # 1. Monophonic C-Major Scale (C4 to C5)
        scale_notes = []
        pitches = [60, 62, 64, 65, 67, 69, 71, 72]  # C4, D4, E4, F4, G4, A4, B4, C5
        for i, p in enumerate(pitches):
            scale_notes.append({
                "pitch": p,
                "start": round(0.2 + i * 0.4, 3),
                "end": round(0.2 + i * 0.4 + 0.32, 3),
                "velocity": 90
            })
        suites["monophonic_scale"] = {
            "name": "단음 음계 (C Major Scale)",
            "description": "C4에서 C5까지 8개 음을 400ms 간격으로 순차 연주",
            "notes": scale_notes
        }

        # 2. Fast Repeated Notes (동일 음 연속 타건: 8 notes/sec)
        rep_notes = []
        for i in range(8):
            rep_notes.append({
                "pitch": 67,  # G4
                "start": round(0.2 + i * 0.15, 3),
                "end": round(0.2 + i * 0.15 + 0.10, 3),
                "velocity": 85
            })
        suites["fast_repeated"] = {
            "name": "빠른 반복음 (Fast Repeated Notes)",
            "description": "G4 단음을 150ms 간격(초당 약 6.6회)으로 반복 타건",
            "notes": rep_notes
        }

        # 3. Sustained Chords (3-note & 4-note Chords)
        chord_notes = [
            # C Major Triad (C4, E4, G4)
            {"pitch": 60, "start": 0.3, "end": 1.6, "velocity": 85},
            {"pitch": 64, "start": 0.3, "end": 1.6, "velocity": 85},
            {"pitch": 67, "start": 0.3, "end": 1.6, "velocity": 85},
            # G7 4-Note Chord (G3, D4, F4, B4)
            {"pitch": 55, "start": 1.9, "end": 3.3, "velocity": 80},
            {"pitch": 62, "start": 1.9, "end": 3.3, "velocity": 80},
            {"pitch": 65, "start": 1.9, "end": 3.3, "velocity": 80},
            {"pitch": 71, "start": 1.9, "end": 3.3, "velocity": 80},
        ]
        suites["sustained_chords"] = {
            "name": "화음 및 지속음 (Sustained Chords)",
            "description": "C Major 3화음과 G7 4화음의 동시 발음 지속성 검증",
            "notes": chord_notes
        }

        # 4. Low & High Register Extremes (저음 C2, C3 vs 고음 C6, G6)
        extreme_notes = [
            {"pitch": 36, "start": 0.2, "end": 0.8, "velocity": 80},  # C2 (65.4 Hz)
            {"pitch": 48, "start": 1.0, "end": 1.6, "velocity": 85},  # C3 (130.8 Hz)
            {"pitch": 84, "start": 1.8, "end": 2.4, "velocity": 90},  # C6 (1046.5 Hz)
            {"pitch": 91, "start": 2.6, "end": 3.2, "velocity": 90},  # G6 (1567.9 Hz)
        ]
        suites["register_extremes"] = {
            "name": "저음·고음 음역 (Register Extremes)",
            "description": "저음부 C2(65Hz)와 고음부 G6(1568Hz) 검출 능력 검증",
            "notes": extreme_notes
        }

        # 5. Silence and Leading Rest (2초 선행 무음 후 멜로디)
        rest_notes = [
            {"pitch": 62, "start": 1.8, "end": 2.4, "velocity": 75},
            {"pitch": 65, "start": 2.6, "end": 3.2, "velocity": 80},
            {"pitch": 69, "start": 3.4, "end": 4.1, "velocity": 85},
        ]
        suites["silence_and_rests"] = {
            "name": "선행 무음 및 쉼표 (Silence & Rests)",
            "description": "첫 1.8초 동안의 완전 무음 구간에서 허위 음표 발생 여부 점검",
            "notes": rest_notes
        }

        # 6. Dynamic Velocity (Pianissimo to Fortissimo)
        dynamic_notes = [
            {"pitch": 64, "start": 0.2, "end": 0.7, "velocity": 35},   # pp
            {"pitch": 64, "start": 0.9, "end": 1.4, "velocity": 60},   # mp
            {"pitch": 64, "start": 1.6, "end": 2.1, "velocity": 95},   # f
            {"pitch": 64, "start": 2.3, "end": 2.8, "velocity": 120},  # ff
        ]
        suites["dynamic_velocity"] = {
            "name": "다이내믹스 강약 (pp to ff)",
            "description": "약한 타건(pp, vel 35)부터 강한 타건(ff, vel 120)까지 검출 및 속도 반영",
            "notes": dynamic_notes
        }

        return suites

    @staticmethod
    def run_benchmark(output_dir: Optional[str] = None) -> Dict[str, Any]:
        """
        Executes the entire suite, verifies against real Basic Pitch model,
        and produces a comprehensive benchmark report.
        """
        if output_dir is None:
            output_dir = tempfile.mkdtemp(prefix="amt_benchmark_")
        os.makedirs(output_dir, exist_ok=True)

        suites = TestSuiteRunner.get_test_suites()
        overall_start = time.time()
        results = []

        total_gt_all = 0
        total_tp_all = 0
        total_est_all = 0
        all_onset_errors = []

        for suite_key, suite_data in suites.items():
            t0 = time.time()
            notes = suite_data["notes"]
            audio_wave = AudioSynthesizer.synthesize_notes(notes, sample_rate=TARGET_SAMPLE_RATE)
            audio_path = os.path.join(output_dir, f"{suite_key}.wav")
            sf.write(audio_path, audio_wave, TARGET_SAMPLE_RATE, subtype='PCM_16')

            # Run Basic Pitch inference
            model_out, midi_obj, note_events = predict(
                audio_path,
                onset_threshold=0.50,
                frame_threshold=0.30,
                minimum_note_length=50
            )

            post_notes = NotePostProcessor.process_notes(
                note_events,
                params={"min_note_len_ms": 50, "merge_tolerance_ms": 30}
            )

            # Roundtrip MIDI test
            suite_midi_path = os.path.join(output_dir, f"{suite_key}.mid")
            midi_verification = MidiWriterAndVerifier.create_midi(post_notes, suite_midi_path)

            eval_res = AMTEvaluator.match_notes(notes, post_notes)
            dt = time.time() - t0

            total_gt_all += eval_res["ground_truth_count"]
            total_est_all += eval_res["estimated_count"]
            total_tp_all += eval_res["true_positives_onset"]
            if eval_res["mean_onset_error_ms"] > 0:
                all_onset_errors.append(eval_res["mean_onset_error_ms"])

            results.append({
                "suite_key": suite_key,
                "name": suite_data["name"],
                "description": suite_data["description"],
                "ground_truth_notes": len(notes),
                "estimated_notes": len(post_notes),
                "precision_onset": eval_res["precision_onset"],
                "recall_onset": eval_res["recall_onset"],
                "f1_onset": eval_res["f1_onset"],
                "precision_offset": eval_res["precision_offset"],
                "recall_offset": eval_res["recall_offset"],
                "f1_offset": eval_res["f1_offset"],
                "mean_onset_error_ms": eval_res["mean_onset_error_ms"],
                "midi_verified": midi_verification["verified"],
                "midi_max_timing_error_ms": midi_verification["max_timing_error_ms"],
                "execution_time_sec": round(dt, 2)
            })

        macro_p = total_tp_all / total_est_all if total_est_all > 0 else 0.0
        macro_r = total_tp_all / total_gt_all if total_gt_all > 0 else 0.0
        macro_f1 = (2 * macro_p * macro_r) / (macro_p + macro_r) if (macro_p + macro_r) > 0 else 0.0
        mean_onset_err = round(float(np.mean(all_onset_errors)), 2) if all_onset_errors else 0.0

        report = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "model_version": MODEL_VERSION,
            "model_sha256": MODEL_SHA256,
            "total_suites_evaluated": len(suites),
            "macro_precision_onset": round(macro_p, 4),
            "macro_recall_onset": round(macro_r, 4),
            "macro_f1_onset": round(macro_f1, 4),
            "average_onset_error_ms": mean_onset_err,
            "total_benchmark_time_sec": round(time.time() - overall_start, 2),
            "suite_results": results,
            "evaluation_criteria": {
                "onset_tolerance": "50ms",
                "offset_tolerance": "max(50ms, 20% of ground-truth duration)",
                "midi_timing_tolerance": "2.0ms roundtrip re-parsing check"
            }
        }

        # Save benchmark report json
        report_file = os.path.join(output_dir, "benchmark_report.json")
        with open(report_file, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)

        return report


if __name__ == "__main__":
    rep = TestSuiteRunner.run_benchmark()
    print("AMT Benchmark Completed!")
    print(json.dumps(rep, indent=2, ensure_ascii=False))
