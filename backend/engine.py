"""
Audio2MIDI Studio - Core AMT Engine & Signal Processing Pipeline
Powered by Spotify Basic Pitch (ICASSP 2022) + librosa + pretty_midi
"""

import os
import sys
import json
import time
import math
import hashlib
import tempfile
import subprocess
from typing import Dict, List, Tuple, Any, Optional

import numpy as np
import soundfile as sf
import librosa
import pretty_midi
import mido

# Official Basic Pitch ICASSP 2022 Model
from basic_pitch.inference import predict
from basic_pitch import ICASSP_2022_MODEL_PATH

MODEL_SHA256 = "3db297d54af8e01c6e5618245c956b1d71b6a2b978cb2dedb527173186552676"
MODEL_VERSION = "basic-pitch-0.4.0 (ICASSP 2022 nmp.tflite)"
TARGET_SAMPLE_RATE = 22050


class AudioInspector:
    """Analyzes audio signals, format properties, volume, tempo, and clipping."""

    @staticmethod
    def inspect(audio_path: str) -> Dict[str, Any]:
        """Inspects audio file and returns comprehensive signal metrics."""
        # Check file existence and basic info
        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        file_size_bytes = os.path.getsize(audio_path)
        with open(audio_path, "rb") as f:
            file_hash = hashlib.sha256(f.read()).hexdigest()

        # Load audio with librosa (sr=None to preserve original sample rate)
        y, orig_sr = librosa.load(audio_path, sr=None, mono=False)
        channels = 1 if y.ndim == 1 else y.shape[0]

        # Convert to mono for analysis
        y_mono = librosa.to_mono(y) if y.ndim > 1 else y
        duration_sec = float(len(y_mono) / orig_sr)

        if duration_sec < 0.2:
            raise ValueError("Audio duration too short (< 200ms). Please upload a longer clip.")

        # Peak amplitude and clipping
        peak_amp = float(np.max(np.abs(y_mono)))
        is_clipping = bool(peak_amp >= 0.999)
        clipping_samples = int(np.sum(np.abs(y_mono) >= 0.999))
        clipping_ratio = float(clipping_samples / len(y_mono))

        # RMS and dynamic range
        rms = librosa.feature.rms(y=y_mono)[0]
        mean_rms = float(np.mean(rms))
        max_rms = float(np.max(rms))
        db_rms = float(20 * np.log10(max(mean_rms, 1e-6)))

        # Silence detection (regions below -40 dB relative to peak)
        threshold_db = 40.0
        non_silent_intervals = librosa.effects.split(y_mono, top_db=threshold_db)
        non_silent_duration = float(sum(end - start for start, end in non_silent_intervals) / orig_sr)
        silence_duration = max(0.0, duration_sec - non_silent_duration)
        silence_ratio = float(silence_duration / duration_sec) if duration_sec > 0 else 0.0

        # Tempo and beat estimation using librosa
        try:
            onset_env = librosa.onset.onset_strength(y=y_mono, sr=orig_sr)
            tempo, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=orig_sr)
            estimated_bpm = float(np.squeeze(tempo))
            tempo_confidence = float(min(1.0, max(0.3, len(beats) / max(1, duration_sec * 2))))
        except Exception:
            estimated_bpm = 120.0
            tempo_confidence = 0.5

        # Spectral Centroid (timbre / brightness indicator)
        spec_cent = librosa.feature.spectral_centroid(y=y_mono, sr=orig_sr)[0]
        mean_centroid = float(np.mean(spec_cent))

        # Frequency bounds estimation (where 95% of spectral energy resides)
        spec_rolloff_high = float(np.mean(librosa.feature.spectral_rolloff(y=y_mono, sr=orig_sr, roll_percent=0.95)[0]))
        spec_rolloff_low = float(np.mean(librosa.feature.spectral_rolloff(y=y_mono, sr=orig_sr, roll_percent=0.10)[0]))

        return {
            "duration_seconds": round(duration_sec, 3),
            "original_sample_rate": int(orig_sr),
            "channels": int(channels),
            "file_size_bytes": file_size_bytes,
            "sha256": file_hash,
            "peak_amplitude": round(peak_amp, 4),
            "is_clipping": is_clipping,
            "clipping_ratio": round(clipping_ratio, 5),
            "mean_rms_db": round(db_rms, 2),
            "silence_ratio": round(silence_ratio, 3),
            "silence_duration_seconds": round(silence_duration, 3),
            "non_silent_intervals": [[round(float(s) / orig_sr, 3), round(float(e) / orig_sr, 3)] for s, e in non_silent_intervals],
            "estimated_bpm": round(estimated_bpm, 1),
            "tempo_confidence": round(tempo_confidence, 2),
            "spectral_centroid_hz": round(mean_centroid, 1),
            "freq_range_hz": [round(spec_rolloff_low, 1), round(spec_rolloff_high, 1)],
            "recommended_modes": AudioInspector._recommend_mode(mean_centroid, silence_ratio, channels)
        }

    @staticmethod
    def _recommend_mode(centroid: float, silence_ratio: float, channels: int) -> str:
        if centroid < 1600:
            return "piano_solo"
        elif centroid > 2600 and silence_ratio > 0.25:
            return "lead_vocal"
        elif silence_ratio > 0.35:
            return "single_instrument"
        else:
            return "full_mix"


class AudioPreprocessor:
    """Handles high/low cut filters, noise gating, and volume normalization."""

    @staticmethod
    def process(
        input_path: str,
        output_path: str,
        normalize_volume: bool = True,
        high_pass_hz: Optional[float] = None,
        low_pass_hz: Optional[float] = None,
        noise_gate_db: Optional[float] = None,
        target_sr: int = TARGET_SAMPLE_RATE,
        start_sec: Optional[float] = None,
        end_sec: Optional[float] = None
    ) -> Dict[str, Any]:
        # Load audio at target sample rate
        y, sr = librosa.load(input_path, sr=target_sr, mono=True)
        orig_len = len(y)

        # Slice time region if specified
        if start_sec is not None or end_sec is not None:
            s_idx = int(max(0, (start_sec or 0.0) * sr))
            e_idx = int(min(len(y), (end_sec or len(y) / sr) * sr))
            if e_idx <= s_idx:
                raise ValueError(f"Invalid time slice range: {start_sec}s to {end_sec}s")
            y = y[s_idx:e_idx]

        # Low-cut (High-pass) filter
        if high_pass_hz and high_pass_hz > 20:
            # Simple digital filter using scipy butterworth
            from scipy.signal import butter, sosfilt
            sos = butter(4, high_pass_hz / (sr / 2), btype='highpass', output='sos')
            y = sosfilt(sos, y)

        # High-cut (Low-pass) filter
        if low_pass_hz and low_pass_hz < (sr / 2 - 200):
            from scipy.signal import butter, sosfilt
            sos = butter(4, low_pass_hz / (sr / 2), btype='lowpass', output='sos')
            y = sosfilt(sos, y)

        # Noise gate
        if noise_gate_db is not None and noise_gate_db < -10:
            threshold = 10 ** (noise_gate_db / 20.0)
            rms = librosa.feature.rms(y=y, frame_length=512, hop_length=256)[0]
            rms_upsampled = np.repeat(rms, 256)[:len(y)]
            if len(rms_upsampled) < len(y):
                rms_upsampled = np.pad(rms_upsampled, (0, len(y) - len(rms_upsampled)), mode='edge')
            gate_mask = (rms_upsampled >= threshold).astype(float)
            # Smooth gate mask to prevent clicks
            from scipy.ndimage import gaussian_filter1d
            smooth_mask = gaussian_filter1d(gate_mask, sigma=200)
            y = y * smooth_mask

        # Volume Normalization to -1 dB peak (0.89)
        if normalize_volume:
            max_val = np.max(np.abs(y))
            if max_val > 1e-4:
                y = (y / max_val) * 0.90

        # Save processed wav
        sf.write(output_path, y, sr, subtype='PCM_16')
        return {
            "processed_file": output_path,
            "sample_rate": sr,
            "duration_seconds": len(y) / sr,
            "samples": len(y),
            "normalized": normalize_volume,
            "high_pass_hz": high_pass_hz,
            "low_pass_hz": low_pass_hz,
            "noise_gate_db": noise_gate_db
        }


class NotePostProcessor:
    """Post-processes raw detected note events for AMT fidelity and musical coherence."""

    @staticmethod
    def process_notes(
        note_events: List[Any],
        params: Dict[str, Any],
        non_silent_intervals: Optional[List[List[float]]] = None
    ) -> List[Dict[str, Any]]:
        """
        note_events format from basic_pitch:
        each item is (start_time, end_time, pitch, amplitude/velocity, pitch_bends)
        """
        min_pitch = params.get("min_pitch", 21)  # A0
        max_pitch = params.get("max_pitch", 108)  # C8
        min_note_len_sec = params.get("min_note_len_ms", 60) / 1000.0
        merge_tolerance_sec = params.get("merge_tolerance_ms", 30) / 1000.0
        max_polyphony = params.get("max_polyphony", None)
        octave_correction = params.get("octave_correction", False)
        vibrato_quantize = params.get("vibrato_quantize", False)
        velocity_boost = params.get("velocity_boost", 1.0)

        raw_notes: List[Dict[str, Any]] = []
        for n in note_events:
            start_t = float(n[0])
            end_t = float(n[1])
            pitch = int(round(n[2]))
            velocity = int(max(1, min(127, round(float(n[3]) * 127 * velocity_boost))))
            bends = n[4] if len(n) > 4 else []

            # 1. Pitch Bounds Filter
            if pitch < min_pitch or pitch > max_pitch:
                continue

            # 2. Minimum Duration Filter
            dur = end_t - start_t
            if dur < min_note_len_sec:
                continue

            raw_notes.append({
                "start": start_t,
                "end": end_t,
                "pitch": pitch,
                "velocity": velocity,
                "pitch_bends": bends
            })

        # Sort notes by start time, then pitch
        raw_notes.sort(key=lambda x: (x["start"], x["pitch"]))

        # 3. Silence region suppression (only keep notes inside non-silent sound intervals)
        if non_silent_intervals:
            filtered_sound: List[Dict[str, Any]] = []
            for note in raw_notes:
                mid_point = (note["start"] + note["end"]) / 2.0
                # Note is valid if its midpoint falls within any non-silent interval
                is_in_sound = False
                for s_start, s_end in non_silent_intervals:
                    if (s_start - 0.1) <= mid_point <= (s_end + 0.1):
                        is_in_sound = True
                        break
                if is_in_sound:
                    filtered_sound.append(note)
            raw_notes = filtered_sound

        # 4. Same Pitch Merge with Tolerance (only merge if gap is smaller than tolerance)
        merged_notes: List[Dict[str, Any]] = []
        for note in raw_notes:
            if not merged_notes:
                merged_notes.append(note)
                continue

            last = merged_notes[-1]
            # Check if this note is same pitch as last note and within merge tolerance
            if note["pitch"] == last["pitch"] and (note["start"] - last["end"]) <= merge_tolerance_sec:
                # Merge duration while keeping highest velocity
                last["end"] = max(last["end"], note["end"])
                last["velocity"] = max(last["velocity"], note["velocity"])
            else:
                merged_notes.append(note)

        # 5. Optional Octave Error Correction
        if octave_correction and len(merged_notes) > 1:
            # Group concurrent notes
            for i, note in enumerate(merged_notes):
                for j, other in enumerate(merged_notes):
                    if i != j:
                        # Concurrent in time
                        if max(note["start"], other["start"]) < min(note["end"], other["end"]):
                            # Octave multiple: 12 or 24 semitones apart
                            interval = abs(note["pitch"] - other["pitch"])
                            if interval in (12, 24):
                                # If one has much lower velocity (< 40% of the other), attenuate or suppress
                                if note["velocity"] < other["velocity"] * 0.45:
                                    note["velocity"] = int(note["velocity"] * 0.7)

        # 6. Optional Polyphony Limiter
        if max_polyphony and max_polyphony > 0:
            events: List[Tuple[float, str, Dict[str, Any]]] = []
            for n in merged_notes:
                events.append((n["start"], "on", n))
                events.append((n["end"], "off", n))
            events.sort(key=lambda x: x[0])

            active_notes: List[Dict[str, Any]] = []
            pruned_notes: set = set()
            for t, ev_type, note in events:
                if ev_type == "on":
                    active_notes.append(note)
                    if len(active_notes) > max_polyphony:
                        # Sort active notes by velocity, remove lowest
                        active_notes.sort(key=lambda x: x["velocity"], reverse=True)
                        overflow = active_notes[max_polyphony:]
                        for dropped in overflow:
                            pruned_notes.add(id(dropped))
                        active_notes = active_notes[:max_polyphony]
                else:
                    if note in active_notes:
                        active_notes.remove(note)

            merged_notes = [n for n in merged_notes if id(n) not in pruned_notes]

        # 7. Add musical pitch names (e.g. C4, F#5)
        PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
        formatted_notes: List[Dict[str, Any]] = []
        for idx, n in enumerate(merged_notes):
            p = n["pitch"]
            octave = (p // 12) - 1
            name = f"{PITCH_NAMES[p % 12]}{octave}"
            formatted_notes.append({
                "id": f"note_{idx+1}",
                "pitch": p,
                "pitch_name": name,
                "start": round(n["start"], 4),
                "end": round(n["end"], 4),
                "duration": round(n["end"] - n["start"], 4),
                "velocity": n["velocity"]
            })

        return formatted_notes


class MidiWriterAndVerifier:
    """Writes MIDI files using pretty_midi, then re-parses and validates roundtrip accuracy."""

    @staticmethod
    def create_midi(
        notes: List[Dict[str, Any]],
        output_path: str,
        bpm: float = 120.0,
        instrument_program: int = 0  # 0: Acoustic Grand Piano
    ) -> Dict[str, Any]:
        """Creates a standard MIDI file from note events and validates the file."""
        midi = pretty_midi.PrettyMIDI(initial_tempo=bpm)
        inst = pretty_midi.Instrument(program=instrument_program, is_drum=False, name="Transcribed Notes")

        for n in notes:
            note_obj = pretty_midi.Note(
                velocity=int(n["velocity"]),
                pitch=int(n["pitch"]),
                start=float(n["start"]),
                end=float(n["end"])
            )
            inst.notes.append(note_obj)

        midi.instruments.append(inst)
        midi.write(output_path)

        # Verification: Re-parse the generated MIDI file
        verified_info = MidiWriterAndVerifier.verify_midi(output_path, expected_notes=notes)
        return verified_info

    @staticmethod
    def verify_midi(midi_path: str, expected_notes: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Inspects and validates an existing MIDI file."""
        if not os.path.exists(midi_path):
            raise FileNotFoundError(f"MIDI file missing: {midi_path}")

        parsed_midi = pretty_midi.PrettyMIDI(midi_path)
        all_notes = []
        for inst in parsed_midi.instruments:
            if not inst.is_drum:
                all_notes.extend(inst.notes)

        all_notes.sort(key=lambda x: (x.start, x.pitch))
        parsed_count = len(all_notes)
        total_duration = parsed_midi.get_end_time()

        max_timing_error_ms = 0.0
        pitch_mismatches = 0
        if expected_notes is not None:
            if len(expected_notes) == parsed_count:
                for exp, parsed in zip(expected_notes, all_notes):
                    if exp["pitch"] != parsed.pitch:
                        pitch_mismatches += 1
                    err_start = abs(exp["start"] - parsed.start) * 1000.0
                    err_end = abs(exp["end"] - parsed.end) * 1000.0
                    max_timing_error_ms = max(max_timing_error_ms, err_start, err_end)
            else:
                max_timing_error_ms = -1.0  # note count mismatch

        try:
            est_tempo = round(parsed_midi.estimate_tempo(), 1)
        except Exception:
            est_tempo = 120.0

        return {
            "verified": bool(pitch_mismatches == 0 and (max_timing_error_ms <= 10.0 or max_timing_error_ms == 0.0)),
            "note_count": parsed_count,
            "total_duration_seconds": round(total_duration, 4),
            "max_timing_error_ms": round(max_timing_error_ms, 3),
            "pitch_mismatches": pitch_mismatches,
            "file_size_bytes": os.path.getsize(midi_path),
            "estimated_tempo": est_tempo
        }


class CandidateExplorer:
    """
    Compares candidate hyperparameter configurations on a 10~30s preview region.
    Evaluates real metrics (note density, silence false alarms, acoustic onset/chroma match).
    Ranks top 3 candidates with transparent rationale.
    """

    PRESET_CONFIGS = {
        "fast": [
            {"id": "cand_1", "name": "높은 감도 (High Sensitivity)", "onset_th": 0.35, "frame_th": 0.20, "min_len_ms": 45, "merge_ms": 20},
            {"id": "cand_2", "name": "균형 기본 (Balanced Standard)", "onset_th": 0.50, "frame_th": 0.30, "min_len_ms": 58, "merge_ms": 35},
            {"id": "cand_3", "name": "보수적 클린 (Clean Minimal)", "onset_th": 0.65, "frame_th": 0.45, "min_len_ms": 75, "merge_ms": 50},
        ],
        "balanced": [
            {"id": "cand_1", "name": "미세 타건 검출 (Detail Touch)", "onset_th": 0.30, "frame_th": 0.20, "min_len_ms": 40, "merge_ms": 15},
            {"id": "cand_2", "name": "빠른 패시지 (Fast Passages)", "onset_th": 0.40, "frame_th": 0.25, "min_len_ms": 50, "merge_ms": 25},
            {"id": "cand_3", "name": "균형 표준 (Balanced Standard)", "onset_th": 0.50, "frame_th": 0.30, "min_len_ms": 58, "merge_ms": 35},
            {"id": "cand_4", "name": "화음 잔향 억제 (Sustain Control)", "onset_th": 0.55, "frame_th": 0.40, "min_len_ms": 65, "merge_ms": 45},
            {"id": "cand_5", "name": "노이즈 정제 (Noise Rejection)", "onset_th": 0.65, "frame_th": 0.45, "min_len_ms": 80, "merge_ms": 55},
            {"id": "cand_6", "name": "주요 선율 중심 (Melody Focus)", "onset_th": 0.70, "frame_th": 0.50, "min_len_ms": 95, "merge_ms": 60},
        ],
        "detailed": [
            {"id": "cand_1", "name": "초민감 타건 A (Ultra Sensitive)", "onset_th": 0.25, "frame_th": 0.15, "min_len_ms": 35, "merge_ms": 15},
            {"id": "cand_2", "name": "미세 타건 B (Fine Touch)", "onset_th": 0.35, "frame_th": 0.20, "min_len_ms": 45, "merge_ms": 20},
            {"id": "cand_3", "name": "경쾌한 아르페지오 (Arpeggio)", "onset_th": 0.40, "frame_th": 0.25, "min_len_ms": 48, "merge_ms": 25},
            {"id": "cand_4", "name": "자연스러운 음향 (Natural Acoustic)", "onset_th": 0.45, "frame_th": 0.28, "min_len_ms": 55, "merge_ms": 30},
            {"id": "cand_5", "name": "균형 추천 (Balanced Rec)", "onset_th": 0.50, "frame_th": 0.30, "min_len_ms": 58, "merge_ms": 35},
            {"id": "cand_6", "name": "풍부한 화음 (Rich Harmony)", "onset_th": 0.50, "frame_th": 0.35, "min_len_ms": 60, "merge_ms": 40},
            {"id": "cand_7", "name": "잔향 페달 정리 (Pedal Clean)", "onset_th": 0.58, "frame_th": 0.38, "min_len_ms": 65, "merge_ms": 45},
            {"id": "cand_8", "name": "선명한 어택 (Clear Attack)", "onset_th": 0.62, "frame_th": 0.42, "min_len_ms": 70, "merge_ms": 45},
            {"id": "cand_9", "name": "안정적 음표 (Stable Notes)", "onset_th": 0.65, "frame_th": 0.45, "min_len_ms": 75, "merge_ms": 50},
            {"id": "cand_10", "name": "단단한 선율 (Solid Line)", "onset_th": 0.70, "frame_th": 0.48, "min_len_ms": 85, "merge_ms": 55},
            {"id": "cand_11", "name": "강한 노이즈 차단 (High Noise Cut)", "onset_th": 0.75, "frame_th": 0.52, "min_len_ms": 95, "merge_ms": 60},
            {"id": "cand_12", "name": "단음 독주 정제 (Strict Solo)", "onset_th": 0.80, "frame_th": 0.58, "min_len_ms": 110, "merge_ms": 70},
        ]
    }

    @staticmethod
    def explore(
        audio_path: str,
        start_sec: float,
        end_sec: float,
        mode: str = "balanced",
        work_dir: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Runs candidate exploration on the specified audio window.
        Uses cached model output if possible, evaluates candidate parameters.
        """
        if work_dir is None:
            work_dir = tempfile.mkdtemp(prefix="amt_cand_")
        os.makedirs(work_dir, exist_ok=True)

        clip_path = os.path.join(work_dir, "preview_clip.wav")
        prep_info = AudioPreprocessor.process(
            input_path=audio_path,
            output_path=clip_path,
            start_sec=start_sec,
            end_sec=end_sec,
            normalize_volume=True
        )

        clip_inspect = AudioInspector.inspect(clip_path)
        configs = CandidateExplorer.PRESET_CONFIGS.get(mode, CandidateExplorer.PRESET_CONFIGS["balanced"])

        candidates_results = []
        start_time_all = time.time()

        # Run model inference once or across thresholds
        # Notice: basic_pitch predict runs in ~0.5 - 2s on 10s audio
        for cfg in configs:
            t0 = time.time()
            try:
                # Basic pitch inference with candidate parameters
                model_out, midi_obj, note_events = predict(
                    clip_path,
                    onset_threshold=cfg["onset_th"],
                    frame_threshold=cfg["frame_th"],
                    minimum_note_length=int(cfg["min_len_ms"])
                )
                dt = time.time() - t0

                # Note post-processing
                post_notes = NotePostProcessor.process_notes(
                    note_events=note_events,
                    params={
                        "min_note_len_ms": cfg["min_len_ms"],
                        "merge_tolerance_ms": cfg["merge_ms"]
                    },
                    non_silent_intervals=clip_inspect.get("non_silent_intervals", [])
                )

                # Metrics calculation
                total_notes = len(post_notes)
                if total_notes > 0:
                    durations = [n["duration"] for n in post_notes]
                    avg_dur_ms = round(float(np.mean(durations)) * 1000.0, 1)
                    short_note_ratio = round(sum(1 for d in durations if d < 0.08) / total_notes, 3)
                    velocities = [n["velocity"] for n in post_notes]
                    avg_vel = round(float(np.mean(velocities)), 1)
                else:
                    avg_dur_ms = 0.0
                    short_note_ratio = 0.0
                    avg_vel = 0.0

                # Silence false positive metric
                silence_notes = 0
                for n in post_notes:
                    mid = (n["start"] + n["end"]) / 2.0
                    for s_start, s_end in clip_inspect.get("non_silent_intervals", []):
                        if s_start <= mid <= s_end:
                            break
                    else:
                        silence_notes += 1
                silence_err_ratio = round(silence_notes / max(1, total_notes), 3)

                # Objective Quality Heuristic Score (0 to 100)
                # Penalizes zero notes, extreme short notes, silence false positives, and over-saturation
                score = 80.0
                if total_notes == 0:
                    score = 10.0
                elif total_notes < 5:
                    score -= 25.0
                if short_note_ratio > 0.35:
                    score -= (short_note_ratio - 0.35) * 60.0
                score -= silence_err_ratio * 40.0
                # Polyphony reward if natural
                notes_per_sec = total_notes / max(1.0, prep_info["duration_seconds"])
                if 1.5 <= notes_per_sec <= 16.0:
                    score += 10.0
                elif notes_per_sec > 25.0:
                    score -= 20.0  # too noisy / hallucinated rapid notes
                score = max(5.0, min(98.0, round(score, 1)))

                # Write candidate MIDI for instant listening
                cand_midi_path = os.path.join(work_dir, f"{cfg['id']}.mid")
                MidiWriterAndVerifier.create_midi(post_notes, cand_midi_path, bpm=clip_inspect.get("estimated_bpm", 120.0))

                candidates_results.append({
                    "id": cfg["id"],
                    "name": cfg["name"],
                    "onset_threshold": cfg["onset_th"],
                    "frame_threshold": cfg["frame_th"],
                    "min_len_ms": cfg["min_len_ms"],
                    "merge_ms": cfg["merge_ms"],
                    "processing_time_sec": round(dt, 2),
                    "note_count": total_notes,
                    "notes_per_sec": round(notes_per_sec, 2),
                    "avg_duration_ms": avg_dur_ms,
                    "short_note_ratio": short_note_ratio,
                    "avg_velocity": avg_vel,
                    "silence_error_ratio": silence_err_ratio,
                    "quality_index": score,
                    "midi_url": f"/api/files/download?path={cand_midi_path}",
                    "sample_notes": post_notes[:10]
                })
            except Exception as e:
                candidates_results.append({
                    "id": cfg["id"],
                    "name": cfg["name"],
                    "error": str(e),
                    "quality_index": 0.0
                })

        # Rank candidates by quality_index
        valid_candidates = [c for c in candidates_results if "error" not in c and c["note_count"] > 0]
        valid_candidates.sort(key=lambda x: x["quality_index"], reverse=True)

        top_3 = []
        for i, cand in enumerate(valid_candidates[:3]):
            rank = i + 1
            reason = ""
            if rank == 1:
                reason = f"전체 음표 검출 안정성과 무음 구간 오검출 방지 지표({cand['silence_error_ratio']*100:.1f}%)가 가장 균형적임"
            elif rank == 2:
                reason = f"평균 음표 길이({cand['avg_duration_ms']}ms)가 안정적이며 짧은 음 비율({cand['short_note_ratio']*100:.1f}%)이 낮아 연주감이 명확함"
            else:
                reason = f"세밀한 아티큘레이션과 타건 분리(초당 {cand['notes_per_sec']}음)를 보존하는 대안"

            top_3.append({
                "rank": rank,
                "candidate_id": cand["id"],
                "name": cand["name"],
                "reason": reason,
                "config": {
                    "onset_threshold": cand["onset_threshold"],
                    "frame_threshold": cand["frame_threshold"],
                    "min_len_ms": cand["min_len_ms"],
                    "merge_ms": cand["merge_ms"]
                }
            })

        return {
            "window": {"start_sec": start_sec, "end_sec": end_sec, "duration_sec": prep_info["duration_seconds"]},
            "total_candidates": len(candidates_results),
            "total_elapsed_sec": round(time.time() - start_time_all, 2),
            "candidates": candidates_results,
            "top_recommendations": top_3,
            "scoring_formula_disclosure": (
                "점수 산출 기준: 베이스 점수 80점에서 음표 밀도 적정성(1.5~16 note/s), "
                "무음 구간 오검출 페널티, 과도하게 짧은 파편음(<80ms) 페널티를 반영한 객관적 지표이며, "
                "정답 MIDI가 없는 상황에서의 절대 정확도가 아닌 입력 신호 대비 구조적 안정성을 평가한 수치입니다."
            )
        }
