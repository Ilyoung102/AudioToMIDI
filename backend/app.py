"""
Audio2MIDI Studio - FastAPI Production Service
Exposes REST endpoints for audio analysis, transcription, candidate comparison, and AMT benchmark.
"""

import os
import sys
import json
import shutil
import tempfile
from typing import Dict, Any, Optional

from fastapi import FastAPI, UploadFile, File, Form, Query, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from backend.engine import (
    AudioInspector,
    AudioPreprocessor,
    NotePostProcessor,
    MidiWriterAndVerifier,
    CandidateExplorer,
    MODEL_VERSION,
    MODEL_SHA256
)
from backend.test_suite import TestSuiteRunner
from basic_pitch.inference import predict

app = FastAPI(
    title="Audio2MIDI Studio AMT Service",
    description="Spotify Basic Pitch & Signal Processing REST API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/tmp/audio2midi_uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "engine": "Spotify Basic Pitch ICASSP 2022",
        "model_version": MODEL_VERSION,
        "model_sha256": MODEL_SHA256,
        "python_version": sys.version
    }


@app.post("/api/analyze")
async def analyze_audio(file: UploadFile = File(...)):
    temp_file = os.path.join(UPLOAD_DIR, f"temp_{file.filename}")
    with open(temp_file, "wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        metrics = AudioInspector.inspect(temp_file)
        return metrics
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if os.path.exists(temp_file):
            try:
                os.remove(temp_file)
            except Exception:
                pass


@app.post("/api/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    params_json: str = Form(default="{}")
):
    try:
        params = json.loads(params_json)
    except Exception:
        params = {}

    job_id = f"job_{int(os.time() if hasattr(os, 'time') else __import__('time').time() * 1000)}"
    job_dir = os.path.join(UPLOAD_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)

    input_path = os.path.join(job_dir, file.filename)
    with open(input_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        # Preprocessing
        prep_wav = os.path.join(job_dir, "preprocessed.wav")
        AudioPreprocessor.process(
            input_path=input_path,
            output_path=prep_wav,
            normalize_volume=params.get("normalize_volume", True),
            high_pass_hz=params.get("high_pass_hz"),
            low_pass_hz=params.get("low_pass_hz"),
            noise_gate_db=params.get("noise_gate_db")
        )

        # Inference
        model_out, raw_midi, note_events = predict(
            prep_wav,
            onset_threshold=float(params.get("onset_threshold", 0.50)),
            frame_threshold=float(params.get("frame_threshold", 0.30)),
            minimum_note_length=int(params.get("min_note_len_ms", 58))
        )

        # Postprocess
        inspect_data = AudioInspector.inspect(prep_wav)
        post_notes = NotePostProcessor.process_notes(
            note_events=note_events,
            params=params,
            non_silent_intervals=inspect_data.get("non_silent_intervals", [])
        )

        # Output MIDI
        post_midi_path = os.path.join(job_dir, "output.mid")
        verification = MidiWriterAndVerifier.create_midi(
            notes=post_notes,
            output_path=post_midi_path,
            bpm=float(params.get("manual_bpm") or inspect_data.get("estimated_bpm") or 120.0)
        )

        return {
            "job_id": job_id,
            "status": "completed",
            "notes": post_notes,
            "note_count": len(post_notes),
            "verification": verification,
            "inspection": inspect_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/benchmark")
def run_benchmark_endpoint():
    try:
        rep = TestSuiteRunner.run_benchmark()
        return rep
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
