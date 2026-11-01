"""
Audio2MIDI Studio - Generate Demo Sample Audio
Creates 4 realistic sample tracks in public/samples/ for instant zero-friction testing.
"""

import os
import numpy as np
import soundfile as sf
from backend.engine import TARGET_SAMPLE_RATE


def generate_all_samples(out_dir: str):
    os.makedirs(out_dir, exist_ok=True)
    sr = TARGET_SAMPLE_RATE

    # 1. Piano Chopin Prelude Style (Chords + Expressive melody)
    duration = 12.0
    t_total = np.linspace(0, duration, int(sr * duration), endpoint=False)
    piano_buf = np.zeros_like(t_total)

    # Progression: C - Am - Dm - G7 - C
    chords = [
        # (start, dur, [pitches], [vels])
        (0.5, 2.4, [48, 60, 64, 67, 72], [90, 80, 85, 85, 95]),   # C Maj
        (3.0, 2.4, [45, 57, 60, 64, 69], [85, 80, 80, 85, 90]),   # Am
        (5.5, 2.4, [50, 57, 62, 65, 69], [85, 80, 85, 80, 90]),   # Dm
        (8.0, 2.4, [43, 55, 59, 62, 65, 71], [90, 85, 80, 80, 85, 95]), # G7
        (10.5, 1.4, [48, 60, 64, 67], [85, 80, 80, 85])           # C
    ]
    for start, dur, pitches, vels in chords:
        for p, v in zip(pitches, vels):
            freq = 440.0 * (2.0 ** ((p - 69) / 12.0))
            s_idx = int(start * sr)
            dur_samples = int(dur * sr)
            t = np.linspace(0, dur, dur_samples, endpoint=False)
            wave = (
                1.0 * np.sin(2 * np.pi * freq * t) +
                0.4 * np.sin(2 * np.pi * 2 * freq * t) +
                0.15 * np.sin(2 * np.pi * 3 * freq * t) +
                0.08 * np.sin(2 * np.pi * 4 * freq * t)
            )
            env = np.exp(-1.4 * np.linspace(0, 1, dur_samples))
            attack = int(min(0.015 * sr, dur_samples * 0.1))
            if attack > 0:
                env[:attack] = np.linspace(0, 1.0, attack)
            e_idx = min(len(piano_buf), s_idx + dur_samples)
            actual_len = e_idx - s_idx
            piano_buf[s_idx:e_idx] += (wave[:actual_len] * env[:actual_len] * (v / 127.0) * 0.25)

    piano_peak = np.max(np.abs(piano_buf))
    if piano_peak > 0:
        piano_buf = (piano_buf / piano_buf.max()) * 0.88
    sf.write(os.path.join(out_dir, "piano_chopin_style.wav"), piano_buf, sr, subtype='PCM_16')

    # 2. Flute / Single Instrument Melodic Solo
    flute_buf = np.zeros_like(t_total)
    melody = [
        # (start, dur, pitch, vel)
        (0.6, 0.7, 72, 85),  # C5
        (1.4, 0.5, 74, 88),  # D5
        (2.0, 0.8, 76, 90),  # E5
        (2.9, 0.5, 79, 95),  # G5
        (3.5, 1.2, 77, 90),  # F5
        (4.8, 0.6, 76, 85),  # E5
        (5.5, 0.6, 74, 85),  # D5
        (6.2, 1.6, 72, 90),  # C5
        (8.0, 0.7, 74, 85),  # D5
        (8.8, 0.7, 76, 88),  # E5
        (9.6, 1.8, 79, 95),  # G5
    ]
    for start, dur, p, v in melody:
        freq = 440.0 * (2.0 ** ((p - 69) / 12.0))
        s_idx = int(start * sr)
        dur_samples = int(dur * sr)
        t = np.linspace(0, dur, dur_samples, endpoint=False)
        # Vibrato 5.5 Hz
        vib = 0.015 * np.sin(2 * np.pi * 5.5 * t)
        inst_freq = freq * (1.0 + vib)
        phase = 2 * np.pi * np.cumsum(inst_freq) / sr
        wave = np.sin(phase) + 0.3 * np.sin(2 * phase) + 0.08 * np.sin(3 * phase)
        # Flute envelope: gentle attack, sustained body, gentle release
        env = np.ones(dur_samples)
        att = int(0.04 * sr)
        rel = int(0.06 * sr)
        if att > 0:
            env[:att] = np.linspace(0, 1.0, att)
        if rel > 0:
            env[-rel:] = np.linspace(1.0, 0, rel)
        e_idx = min(len(flute_buf), s_idx + dur_samples)
        flute_buf[s_idx:e_idx] += wave[:e_idx - s_idx] * env[:e_idx - s_idx] * (v / 127.0)

    flute_peak = np.max(np.abs(flute_buf))
    if flute_peak > 0:
        flute_buf = (flute_buf / flute_peak) * 0.88
    sf.write(os.path.join(out_dir, "flute_instrument_solo.wav"), flute_buf, sr, subtype='PCM_16')

    # 3. Vocal Lead Ballad (Human-like vocal format tones with vibrato)
    vocal_buf = np.zeros_like(t_total)
    vocal_notes = [
        (0.8, 0.9, 65, 80),  # F4
        (1.8, 0.7, 67, 85),  # G4
        (2.6, 1.3, 69, 90),  # A4
        (4.0, 0.8, 67, 85),  # G4
        (4.9, 1.5, 65, 85),  # F4
        (6.6, 0.8, 64, 80),  # E4
        (7.5, 0.9, 62, 80),  # D4
        (8.5, 2.2, 60, 90),  # C4
    ]
    for start, dur, p, v in vocal_notes:
        freq = 440.0 * (2.0 ** ((p - 69) / 12.0))
        s_idx = int(start * sr)
        dur_samples = int(dur * sr)
        t = np.linspace(0, dur, dur_samples, endpoint=False)
        # Vocal vibrato starts after 0.2s onset
        vib_depth = np.clip((t - 0.2) / 0.3, 0.0, 1.0) * 0.02
        vib = vib_depth * np.sin(2 * np.pi * 5.2 * t)
        phase = 2 * np.pi * np.cumsum(freq * (1.0 + vib)) / sr
        # Formant-like harmonics
        wave = (
            1.00 * np.sin(phase) +
            0.60 * np.sin(2 * phase) +
            0.40 * np.sin(3 * phase) +
            0.15 * np.sin(4 * phase)
        )
        env = np.ones(dur_samples)
        att = int(0.06 * sr)
        rel = int(0.10 * sr)
        if att > 0:
            env[:att] = np.linspace(0, 1.0, att)
        if rel > 0:
            env[-rel:] = np.linspace(1.0, 0, rel)
        e_idx = min(len(vocal_buf), s_idx + dur_samples)
        vocal_buf[s_idx:e_idx] += wave[:e_idx - s_idx] * env[:e_idx - s_idx] * (v / 127.0)

    vocal_peak = np.max(np.abs(vocal_buf))
    if vocal_peak > 0:
        vocal_buf = (vocal_buf / vocal_peak) * 0.88
    sf.write(os.path.join(out_dir, "vocal_lead_ballad.wav"), vocal_buf, sr, subtype='PCM_16')

    # 4. Polyphonic Band Groove (Bass + Chords + Lead)
    mix_buf = piano_buf * 0.6 + flute_buf * 0.7
    # Add bass line
    bass_notes = [
        (0.5, 2.3, 36, 95),  # C2
        (3.0, 2.3, 33, 95),  # A1
        (5.5, 2.3, 38, 95),  # D2
        (8.0, 2.3, 31, 95),  # G1
        (10.5, 1.4, 36, 95)  # C2
    ]
    for start, dur, p, v in bass_notes:
        freq = 440.0 * (2.0 ** ((p - 69) / 12.0))
        s_idx = int(start * sr)
        dur_samples = int(dur * sr)
        t = np.linspace(0, dur, dur_samples, endpoint=False)
        wave = 1.0 * np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * 2 * freq * t)
        env = np.exp(-1.2 * np.linspace(0, 1, dur_samples))
        att = int(0.02 * sr)
        if att > 0:
            env[:att] = np.linspace(0, 1.0, att)
        e_idx = min(len(mix_buf), s_idx + dur_samples)
        mix_buf[s_idx:e_idx] += wave[:e_idx - s_idx] * env[:e_idx - s_idx] * 0.45

    mix_peak = np.max(np.abs(mix_buf))
    if mix_peak > 0:
        mix_buf = (mix_buf / mix_peak) * 0.88
    sf.write(os.path.join(out_dir, "polyphonic_band_groove.wav"), mix_buf, sr, subtype='PCM_16')

    print(f"Generated 4 sample files in {out_dir}")


if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "public/samples"
    generate_all_samples(out)
