import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Music, Sliders, Download, BookOpen, Award, CheckCircle2,
  AlertCircle, Sparkles, RefreshCw, Volume2, ShieldCheck
} from 'lucide-react';

import {
  NoteEvent, AudioInspection, ConversionParams, CandidateExplorationData,
  ConversionReport, DemoSample
} from './types/amt';
import { AudioWaveform } from './components/AudioWaveform';
import { SettingsPanel } from './components/SettingsPanel';
import { CandidateExplorer } from './components/CandidateExplorer';
import { PianoRoll } from './components/PianoRoll';
import { PlaybackController } from './components/PlaybackController';
import { ExportModal } from './components/ExportModal';
import { BenchmarkModal } from './components/BenchmarkModal';
import { GuideModal } from './components/GuideModal';
import { synth } from './utils/synth';

export default function App() {
  // Audio Playback State
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string>('sample_chopin_piano.wav');
  const [audioPathOnServer, setAudioPathOnServer] = useState<string>('/samples/piano_chopin_style.wav');
  const [duration, setDuration] = useState<number>(12.0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLooping, setIsLooping] = useState<boolean>(false);

  // Synchronized Dual Mode (A: audio, B: midi, both: A+B)
  const [playbackMode, setPlaybackMode] = useState<'audio' | 'midi' | 'both'>('both');
  const [audioVolume, setAudioVolume] = useState<number>(0.8);
  const [audioMuted, setAudioMuted] = useState<boolean>(false);
  const [midiVolume, setMidiVolume] = useState<number>(0.85);
  const [midiMuted, setMidiMuted] = useState<boolean>(false);

  // Region / Window Selection for 10-30s preview comparison
  const [useRegion, setUseRegion] = useState<boolean>(true);
  const [regionStart, setRegionStart] = useState<number>(0.0);
  const [regionEnd, setRegionEnd] = useState<number>(12.0);

  // Signal Analysis & Inspection
  const [inspection, setInspection] = useState<AudioInspection | null>(null);
  const [samples, setSamples] = useState<DemoSample[]>([]);

  // Conversion Parameters
  const [params, setParams] = useState<ConversionParams>({
    mode: 'piano_solo',
    search_preset: 'balanced',
    use_range: false,
    onset_threshold: 0.50,
    frame_threshold: 0.30,
    min_note_len_ms: 58,
    min_pitch: 21,
    max_pitch: 108,
    merge_tolerance_ms: 35,
    octave_correction: false,
    vibrato_quantize: false,
    velocity_boost: 1.0,
    normalize_volume: true,
    quantize_grid: 'none',
    quantize_strength: 0.8
  });

  // Notes & Job State
  const [notes, setNotes] = useState<NoteEvent[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [jobStatus, setJobStatus] = useState<string>('');
  const [jobProgress, setJobProgress] = useState<number>(0);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [conversionReport, setConversionReport] = useState<ConversionReport | null>(null);
  const [outputFiles, setOutputFiles] = useState<{
    raw_midi?: string;
    post_midi?: string;
    user_edited_midi?: string;
    notes_csv?: string;
    report_json?: string;
  }>({});

  // Candidate Exploration State
  const [candidateData, setCandidateData] = useState<CandidateExplorationData | null>(null);
  const [isExploring, setIsExploring] = useState<boolean>(false);

  // Modals
  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);
  const [isBenchmarkOpen, setIsBenchmarkOpen] = useState<boolean>(false);
  const [isGuideOpen, setIsGuideOpen] = useState<boolean>(false);
  const [isSavingMidi, setIsSavingMidi] = useState<boolean>(false);

  // Active notes scheduler tracking
  const scheduledNotesRef = useRef<Set<string>>(new Set());

  // Initialize sample list and load first demo sample
  useEffect(() => {
    const fetchSamples = async () => {
      try {
        const res = await fetch('/api/samples');
        const data = await res.json();
        if (data.samples && data.samples.length > 0) {
          setSamples(data.samples);
          const first = data.samples[0];
          setAudioUrl(first.url);
          setAudioName(first.title);
          setAudioPathOnServer(first.url);
          setDuration(first.duration_sec);
          setRegionEnd(first.duration_sec);

          // Run inspect on initial sample
          inspectFile(first.url);
        }
      } catch (err) {
        console.error('Failed to load samples:', err);
      }
    };
    fetchSamples();
  }, []);

  // Inspect file on server
  const inspectFile = async (path: string) => {
    try {
      const res = await fetch('/api/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioPath: path }),
      });
      const data = await res.json();
      if (data.success && data.inspection) {
        setInspection(data.inspection);
        setDuration(data.inspection.duration_seconds);
        setRegionEnd(data.inspection.duration_seconds);
      }
    } catch (e) {
      console.error('Inspect error:', e);
    }
  };

  // Upload custom user audio file
  const handleFileUpload = async (file: File) => {
    setIsProcessing(true);
    setJobStatus('파일 업로드 및 파형 검사 중...');
    setJobProgress(10);

    const formData = new FormData();
    formData.append('audio', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!data.success) {
        alert('업로드 실패: ' + (data.error || '알 수 없는 오류'));
        return;
      }

      const localBlobUrl = URL.createObjectURL(file);
      setAudioUrl(localBlobUrl);
      setAudioName(file.name);
      setAudioPathOnServer(data.file.path);
      setInspection(data.inspection);
      setDuration(data.inspection.duration_seconds);
      setRegionStart(0);
      setRegionEnd(Math.min(30, data.inspection.duration_seconds));

      // Reset previous transcription notes
      setNotes([]);
      setCandidateData(null);
    } catch (err: any) {
      alert('업로드 오류: ' + err.message);
    } finally {
      setIsProcessing(false);
      setJobStatus('');
      setJobProgress(0);
    }
  };

  // Select built-in demo sample
  const handleSelectSample = (sample: DemoSample) => {
    if (isPlaying) handleStop();
    setAudioUrl(sample.url);
    setAudioName(sample.title);
    setAudioPathOnServer(sample.url);
    setDuration(sample.duration_sec);
    setRegionStart(0);
    setRegionEnd(sample.duration_sec);
    setNotes([]);
    setCandidateData(null);
    inspectFile(sample.url);
  };

  // Start Full Conversion
  const handleStartConversion = async () => {
    if (!audioPathOnServer) {
      alert('변환할 오디오 파일이 없습니다.');
      return;
    }

    setIsProcessing(true);
    setJobStatus('변환 큐에 작업 등록 중...');
    setJobProgress(10);

    const conversionPayload = {
      audioPath: audioPathOnServer,
      params: {
        ...params,
        start_sec: useRegion ? regionStart : undefined,
        end_sec: useRegion ? regionEnd : undefined,
        manual_bpm: inspection?.estimated_bpm || 120.0
      }
    };

    try {
      const res = await fetch('/api/jobs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conversionPayload)
      });
      const data = await res.json();
      if (!data.success) {
        alert('변환 실패: ' + data.error);
        setIsProcessing(false);
        return;
      }

      setActiveJobId(data.jobId);
      pollJobStatus(data.jobId);
    } catch (err: any) {
      alert('변환 요청 오류: ' + err.message);
      setIsProcessing(false);
    }
  };

  // Poll job status until completed
  const pollJobStatus = async (jobId: string) => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        const data = await res.json();

        setJobStatus(data.stepMessage);
        setJobProgress(data.progress || 50);

        if (data.status === 'completed') {
          clearInterval(timer);
          setIsProcessing(false);
          setActiveJobId(null);

          if (data.result && data.result.notes) {
            setNotes(data.result.notes);
            setOutputFiles(data.result.files || {});
            setConversionReport(data.result.report || null);
          }
        } else if (data.status === 'error' || data.status === 'cancelled') {
          clearInterval(timer);
          setIsProcessing(false);
          setActiveJobId(null);
          alert(data.error || '변환이 중단되었습니다.');
        }
      } catch (err) {
        clearInterval(timer);
        setIsProcessing(false);
      }
    }, 400);
  };

  // Run Candidate Exploration on preview region
  const handleExploreCandidates = async () => {
    if (!audioPathOnServer) return;
    setIsExploring(true);

    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioPath: audioPathOnServer,
          startSec: useRegion ? regionStart : 0,
          endSec: useRegion ? regionEnd : Math.min(20, duration),
          mode: params.search_preset
        })
      });
      const data = await res.json();
      if (data.success) {
        setCandidateData(data);
      } else {
        alert('후보 탐색 실패: ' + (data.error || '알 수 없는 오류'));
      }
    } catch (err: any) {
      alert('후보 탐색 오류: ' + err.message);
    } finally {
      setIsExploring(false);
    }
  };

  // Apply candidate recommended config
  const handleApplyCandidateConfig = (cfg: Partial<ConversionParams>) => {
    setParams((prev) => ({
      ...prev,
      ...cfg
    }));
    // Flash visual feedback
  };

  // Audio HTML Element playback sync
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = audioMuted ? 0 : audioVolume;

    const handleTimeUpdate = () => {
      const t = audio.currentTime;
      setCurrentTime(t);

      // Loop region
      if (isLooping && useRegion && t >= regionEnd) {
        audio.currentTime = regionStart;
        setCurrentTime(regionStart);
        scheduledNotesRef.current.clear();
        synth.allNotesOff();
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      synth.allNotesOff();
      scheduledNotesRef.current.clear();
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [audioMuted, audioVolume, isLooping, useRegion, regionStart, regionEnd]);

  // Synchronized MIDI trigger clock
  useEffect(() => {
    if (!isPlaying || notes.length === 0) return;
    if (playbackMode === 'audio' || midiMuted) {
      synth.allNotesOff();
      return;
    }

    // Check notes that trigger in this window (~50ms lookahead)
    const windowStart = currentTime - 0.02;
    const windowEnd = currentTime + 0.06;

    notes.forEach((note) => {
      if (note.start >= windowStart && note.start <= windowEnd) {
        if (!scheduledNotesRef.current.has(note.id)) {
          scheduledNotesRef.current.add(note.id);
          synth.noteOn(note.pitch, note.velocity, note.duration);
        }
      }
    });

    // Cleanup past notes from scheduled set
    if (scheduledNotesRef.current.size > 200) {
      scheduledNotesRef.current.clear();
    }
  }, [currentTime, isPlaying, notes, playbackMode, midiMuted]);

  // Transport Controls
  const handleTogglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      synth.allNotesOff();
    } else {
      // If audio is muted or mode is midi-only, still run time update
      if (playbackMode === 'midi') {
        audio.muted = true;
      } else {
        audio.muted = audioMuted;
      }

      audio.play().catch(console.error);
      setIsPlaying(true);
    }
  };

  const handleStop = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = useRegion ? regionStart : 0;
      setCurrentTime(useRegion ? regionStart : 0);
    }
    setIsPlaying(false);
    synth.allNotesOff();
    scheduledNotesRef.current.clear();
  };

  const handleSeek = (newTime: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = newTime;
    }
    setCurrentTime(newTime);
    scheduledNotesRef.current.clear();
    synth.allNotesOff();
  };

  // Save edited MIDI to server
  const handleSaveEditedMidi = async () => {
    setIsSavingMidi(true);
    try {
      const res = await fetch('/api/save-edited-midi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes,
          bpm: inspection?.estimated_bpm || 120.0,
          jobId: activeJobId || 'edited'
        })
      });
      const data = await res.json();
      if (data.success) {
        setOutputFiles((prev) => ({
          ...prev,
          user_edited_midi: data.filePath
        }));
        setIsExportOpen(true);
      }
    } catch (err: any) {
      alert('수정 MIDI 저장 실패: ' + err.message);
    } finally {
      setIsSavingMidi(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Hidden native audio element for master clock */}
      <audio
        ref={audioRef}
        src={audioUrl || undefined}
        preload="auto"
      />

      {/* Top Bar Contract (1-line Brand wordmark, 4-5 single-line links, 1 primary action) */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
        {/* Zone 1: Wordmark */}
        <a href="/" className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500 text-slate-950 font-black text-sm">
            ♫
          </span>
          Audio2MIDI Studio
        </a>

        {/* Zone 2: Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-400">
          <button
            onClick={() => {}}
            className="text-amber-400 font-semibold whitespace-nowrap shrink-0 hover:text-amber-300"
          >
            변환 워크스테이션
          </button>
          <button
            onClick={handleExploreCandidates}
            className="hover:text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            후보 비교·추천
          </button>
          <button
            onClick={() => setIsBenchmarkOpen(true)}
            className="hover:text-slate-200 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1"
          >
            <Award className="h-3.5 w-3.5 text-amber-400" />
            검증 벤치마크
          </button>
          <button
            onClick={() => setIsGuideOpen(true)}
            className="hover:text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            기술 매뉴얼 & 가이드
          </button>
        </nav>

        {/* Zone 3: Primary Action */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setIsExportOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-amber-500 rounded-lg hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 shadow-sm"
          >
            <Download className="h-3.5 w-3.5" />
            내보내기 & 리포트
          </button>
        </div>
      </header>

      {/* Main Workspace Viewport */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 py-4 space-y-4">
        {/* Active Processing Progress Bar */}
        {isProcessing && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 animate-pulse">
            <div className="flex items-center justify-between text-xs font-semibold text-amber-300 mb-2">
              <span className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-amber-400" />
                {jobStatus}
              </span>
              <span className="font-mono tabular-nums">{jobProgress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-amber-500 transition-all duration-300 rounded-full"
                style={{ width: `${jobProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* 1. Waveform & Range Selection */}
        <AudioWaveform
          audioUrl={audioUrl}
          audioName={audioName}
          duration={duration}
          currentTime={currentTime}
          isPlaying={isPlaying}
          onSeek={handleSeek}
          onFileUpload={handleFileUpload}
          inspection={inspection}
          regionStart={regionStart}
          regionEnd={regionEnd}
          useRegion={useRegion}
          onRegionChange={(s, e) => {
            setRegionStart(s);
            setRegionEnd(e);
          }}
          onToggleUseRegion={setUseRegion}
          samples={samples}
          onSelectSample={handleSelectSample}
          isProcessing={isProcessing}
        />

        {/* 2. Settings Panel */}
        <SettingsPanel
          params={params}
          onChange={setParams}
          estimatedBpm={inspection?.estimated_bpm}
          isProcessing={isProcessing}
          onExploreCandidates={handleExploreCandidates}
          onStartConversion={handleStartConversion}
        />

        {/* 3. Candidate Exploration & Recommendation Viewer */}
        {(isExploring || candidateData) && (
          <CandidateExplorer
            data={candidateData}
            isLoading={isExploring}
            onApplyConfig={handleApplyCandidateConfig}
            onClose={() => setCandidateData(null)}
          />
        )}

        {/* 4. Canvas-based Interactive Piano Roll */}
        <PianoRoll
          notes={notes}
          onChangeNotes={setNotes}
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          onSeek={handleSeek}
          bpm={inspection?.estimated_bpm || 120.0}
          onSaveEditedMidi={handleSaveEditedMidi}
          isSavingMidi={isSavingMidi}
        />
      </main>

      {/* Synchronized A-B Playback Controller */}
      <PlaybackController
        isPlaying={isPlaying}
        onTogglePlay={handleTogglePlay}
        onStop={handleStop}
        playbackMode={playbackMode}
        onChangePlaybackMode={(m) => {
          setPlaybackMode(m);
          const audio = audioRef.current;
          if (audio) {
            audio.muted = m === 'midi' || audioMuted;
          }
        }}
        currentTime={currentTime}
        duration={duration}
        audioVolume={audioVolume}
        onChangeAudioVolume={(v) => {
          setAudioVolume(v);
          if (audioRef.current) audioRef.current.volume = v;
        }}
        audioMuted={audioMuted}
        onToggleAudioMute={() => {
          setAudioMuted(!audioMuted);
          if (audioRef.current) audioRef.current.muted = !audioMuted;
        }}
        midiVolume={midiVolume}
        onChangeMidiVolume={(v) => {
          setMidiVolume(v);
          synth.setVolume(v);
        }}
        midiMuted={midiMuted}
        onToggleMidiMute={() => {
          setMidiMuted(!midiMuted);
          synth.setMute(!midiMuted);
        }}
        isLooping={isLooping}
        onToggleLoop={() => setIsLooping(!isLooping)}
        hasMidi={notes.length > 0}
      />

      {/* Modals */}
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        report={conversionReport}
        files={outputFiles}
        notes={notes}
        params={params}
      />

      <BenchmarkModal
        isOpen={isBenchmarkOpen}
        onClose={() => setIsBenchmarkOpen(false)}
      />

      <GuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
      />
    </div>
  );
}
