export interface NoteEvent {
  id: string;
  pitch: number;
  pitch_name: string;
  start: number;
  end: number;
  duration: number;
  velocity: number;
  selected?: boolean;
}

export interface AudioInspection {
  duration_seconds: number;
  original_sample_rate: number;
  channels: number;
  file_size_bytes: number;
  sha256: string;
  peak_amplitude: number;
  is_clipping: boolean;
  clipping_ratio: number;
  mean_rms_db: number;
  silence_ratio: number;
  silence_duration_seconds: number;
  non_silent_intervals: [number, number][];
  estimated_bpm: number;
  tempo_confidence: number;
  spectral_centroid_hz: number;
  freq_range_hz: [number, number];
  recommended_modes: string;
}

export interface ConversionParams {
  mode: 'piano_solo' | 'single_instrument' | 'lead_vocal' | 'full_mix';
  search_preset: 'fast' | 'balanced' | 'detailed';
  use_range: boolean;
  start_sec?: number;
  end_sec?: number;
  
  // Basic Pitch Core Params
  onset_threshold: number;
  frame_threshold: number;
  min_note_len_ms: number;
  
  // Post-processing
  min_pitch: number;
  max_pitch: number;
  merge_tolerance_ms: number;
  max_polyphony?: number;
  octave_correction: boolean;
  vibrato_quantize: boolean;
  velocity_boost: number;
  
  // Audio Preprocessing
  normalize_volume: boolean;
  high_pass_hz?: number;
  low_pass_hz?: number;
  noise_gate_db?: number;
  
  // Timing & Tempo
  manual_bpm?: number;
  quantize_grid: 'none' | '1/4' | '1/8' | '1/16' | '1/32' | 'triplet';
  quantize_strength: number; // 0 to 1.0
}

export interface CandidateResult {
  id: string;
  name: string;
  onset_threshold: number;
  frame_threshold: number;
  min_len_ms: number;
  merge_ms: number;
  processing_time_sec: number;
  note_count: number;
  notes_per_sec: number;
  avg_duration_ms: number;
  short_note_ratio: number;
  avg_velocity: number;
  silence_error_ratio: number;
  quality_index: number;
  midi_url?: string;
  sample_notes?: NoteEvent[];
}

export interface TopRecommendation {
  rank: number;
  candidate_id: string;
  name: string;
  reason: string;
  config: Partial<ConversionParams>;
}

export interface CandidateExplorationData {
  window: { start_sec: number; end_sec: number; duration_sec: number };
  total_candidates: number;
  total_elapsed_sec: number;
  candidates: CandidateResult[];
  top_recommendations: TopRecommendation[];
  scoring_formula_disclosure: string;
}

export interface BenchmarkSuiteResult {
  suite_key: string;
  name: string;
  description: string;
  ground_truth_notes: number;
  estimated_notes: number;
  precision_onset: number;
  recall_onset: number;
  f1_onset: number;
  precision_offset: number;
  recall_offset: number;
  f1_offset: number;
  mean_onset_error_ms: number;
  midi_verified: boolean;
  midi_max_timing_error_ms: number;
  execution_time_sec: number;
}

export interface BenchmarkReport {
  timestamp: string;
  model_version: string;
  model_sha256: string;
  total_suites_evaluated: number;
  macro_precision_onset: number;
  macro_recall_onset: number;
  macro_f1_onset: number;
  average_onset_error_ms: number;
  total_benchmark_time_sec: number;
  suite_results: BenchmarkSuiteResult[];
  evaluation_criteria: {
    onset_tolerance: string;
    offset_tolerance: string;
    midi_timing_tolerance: string;
  };
}

export interface ConversionReport {
  engine: string;
  model_version: string;
  model_sha256: string;
  input_file: string;
  input_sha256: string;
  duration_seconds: number;
  applied_params: ConversionParams;
  timing_breakdown: {
    inspection_sec: number;
    preprocessing_sec: number;
    inference_sec: number;
    postprocessing_sec: number;
    total_sec: number;
  };
  raw_note_count: number;
  post_note_count: number;
  pruned_notes: number;
  midi_verification: {
    verified: boolean;
    note_count: number;
    total_duration_seconds: number;
    max_timing_error_ms: number;
    pitch_mismatches: number;
    file_size_bytes: number;
    estimated_tempo: number;
  };
  timestamp: string;
}

export interface DemoSample {
  id: string;
  title: string;
  filename: string;
  url: string;
  mode: 'piano_solo' | 'single_instrument' | 'lead_vocal' | 'full_mix';
  description: string;
  duration_sec: number;
}
