import React, { useEffect, useRef, useState } from 'react';
import { Upload, Music, Clock, Activity, AlertCircle, Volume2, Sparkles } from 'lucide-react';
import { AudioInspection, DemoSample } from '../types/amt';

interface AudioWaveformProps {
  audioUrl: string | null;
  audioName: string;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  onSeek: (time: number) => void;
  onFileUpload: (file: File) => void;
  inspection: AudioInspection | null;
  regionStart: number;
  regionEnd: number;
  useRegion: boolean;
  onRegionChange: (start: number, end: number) => void;
  onToggleUseRegion: (use: boolean) => void;
  samples: DemoSample[];
  onSelectSample: (sample: DemoSample) => void;
  isProcessing: boolean;
}

export const AudioWaveform: React.FC<AudioWaveformProps> = ({
  audioUrl,
  audioName,
  duration,
  currentTime,
  isPlaying,
  onSeek,
  onFileUpload,
  inspection,
  regionStart,
  regionEnd,
  useRegion,
  onRegionChange,
  onToggleUseRegion,
  samples,
  onSelectSample,
  isProcessing
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [waveformData, setWaveformData] = useState<Float32Array | null>(null);
  const [isDraggingRegion, setIsDraggingRegion] = useState<'start' | 'end' | 'pan' | null>(null);
  const [dragStartX, setDragStartX] = useState(0);

  // Decode audio buffer when audioUrl changes to build accurate waveform peaks
  useEffect(() => {
    if (!audioUrl) {
      setWaveformData(null);
      return;
    }

    let isMounted = true;
    const fetchAndDecode = async () => {
      try {
        const response = await fetch(audioUrl);
        const arrayBuffer = await response.arrayBuffer();
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const rawData = audioBuffer.getChannelData(0); // channel 0
        const samplesCount = 1200; // resolution
        const blockSize = Math.floor(rawData.length / samplesCount);
        const peaks = new Float32Array(samplesCount);

        for (let i = 0; i < samplesCount; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[i * blockSize + j]);
          }
          peaks[i] = sum / blockSize;
        }

        // Normalize peaks
        let maxPeak = 0;
        for (let i = 0; i < samplesCount; i++) {
          if (peaks[i] > maxPeak) maxPeak = peaks[i];
        }
        if (maxPeak > 0) {
          for (let i = 0; i < samplesCount; i++) {
            peaks[i] = peaks[i] / maxPeak;
          }
        }

        if (isMounted) {
          setWaveformData(peaks);
        }
        ctx.close();
      } catch (err) {
        console.error('Waveform decode error:', err);
      }
    };

    fetchAndDecode();
    return () => {
      isMounted = false;
    };
  }, [audioUrl]);

  // Draw waveform canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Background grid lines (1s markers)
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    const secCount = Math.max(1, Math.ceil(duration));
    for (let s = 0; s <= secCount; s += 2) {
      const x = (s / duration) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText(`${s}s`, x + 3, 12);
    }

    // Render Waveform bars
    if (waveformData) {
      const len = waveformData.length;
      const barWidth = width / len;

      for (let i = 0; i < len; i++) {
        const x = i * barWidth;
        const normTime = (i / len) * duration;
        const val = waveformData[i];
        const barH = Math.max(2, val * (height - 30));
        const y = (height / 2) - (barH / 2);

        // Highlight region
        const inRegion = useRegion && normTime >= regionStart && normTime <= regionEnd;
        const played = normTime <= currentTime;

        if (inRegion) {
          ctx.fillStyle = played ? '#fbbf24' : '#f59e0b';
        } else {
          ctx.fillStyle = played ? '#38bdf8' : '#334155';
        }

        ctx.fillRect(x, y, Math.max(1.2, barWidth - 0.5), barH);
      }
    } else {
      // Placeholder bars when loading
      ctx.fillStyle = '#1e293b';
      ctx.font = '13px Plus Jakarta Sans, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('오디오 파형을 디코딩하는 중...', width / 2, height / 2);
    }

    // Highlight selected region overlay
    if (useRegion && duration > 0) {
      const rStartX = (regionStart / duration) * width;
      const rEndX = (regionEnd / duration) * width;

      // Unselected dimmed masks
      ctx.fillStyle = 'rgba(2, 6, 23, 0.65)';
      ctx.fillRect(0, 0, rStartX, height);
      ctx.fillRect(rEndX, 0, width - rEndX, height);

      // Selected region border
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.strokeRect(rStartX, 0, rEndX - rStartX, height);

      // Region start & end handle flags
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(rStartX - 2, 0, 4, height);
      ctx.fillRect(rEndX - 2, 0, 4, height);

      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillStyle = '#fbbf24';
      ctx.textAlign = 'left';
      ctx.fillText(`▶ ${regionStart.toFixed(1)}s`, rStartX + 6, height - 8);
      ctx.textAlign = 'right';
      ctx.fillText(`${regionEnd.toFixed(1)}s ◀`, rEndX - 6, height - 8);
    }

    // Playhead Indicator
    if (duration > 0) {
      const playX = (currentTime / duration) * width;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, height);
      ctx.stroke();

      // Playhead triangle cap
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(playX - 5, 0);
      ctx.lineTo(playX + 5, 0);
      ctx.lineTo(playX, 8);
      ctx.closePath();
      ctx.fill();
    }
  }, [waveformData, duration, currentTime, useRegion, regionStart, regionEnd]);

  // Handle clicking on waveform to seek
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDraggingRegion) return;
    const canvas = canvasRef.current;
    if (!canvas || duration <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    onSeek(ratio * duration);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onFileUpload(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 shadow-sm backdrop-blur-sm">
      {/* Top row: File info + Presets button */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Music className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-100">{audioName}</h2>
              {inspection?.is_clipping && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-rose-400">
                  <AlertCircle className="h-3 w-3" />
                  클리핑 감지
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
              <span>{Math.floor(currentTime / 60)}:{(currentTime % 60).toFixed(1).padStart(4, '0')}</span>
              <span>/</span>
              <span>{Math.floor(duration / 60)}:{(duration % 60).toFixed(1).padStart(4, '0')}</span>
              {inspection && (
                <>
                  <span className="text-slate-600">·</span>
                  <span>{inspection.original_sample_rate.toLocaleString()} Hz</span>
                  <span className="text-slate-600">·</span>
                  <span>추정 {inspection.estimated_bpm} BPM</span>
                  <span className="text-slate-600">·</span>
                  <span>무음 {(inspection.silence_ratio * 100).toFixed(0)}%</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Demo track selector & Upload button */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-lg border border-slate-700/60 text-xs">
            <span className="px-2 text-slate-400 text-[11px]">샘플 음원:</span>
            {samples.map((s) => (
              <button
                key={s.id}
                onClick={() => onSelectSample(s)}
                disabled={isProcessing}
                className="rounded px-2.5 py-1 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                title={s.description}
              >
                {s.title.split(' ')[0]}
              </button>
            ))}
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 border border-slate-700 hover:bg-slate-700 transition-colors"
          >
            <Upload className="h-3.5 w-3.5" />
            MP3/WAV 업로드
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mp3,audio/wav,audio/mpeg,audio/flac,audio/ogg"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                onFileUpload(e.target.files[0]);
              }
            }}
          />
        </div>
      </div>

      {/* Waveform Canvas & Scrubber */}
      <div
        ref={containerRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="relative h-28 w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-950 cursor-pointer"
      >
        <canvas
          ref={canvasRef}
          width={1200}
          height={112}
          onClick={handleCanvasClick}
          className="h-full w-full block"
        />

        {/* Upload drop prompt if no audio loaded */}
        {!audioUrl && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 text-center p-4">
            <Upload className="h-8 w-8 text-slate-500 mb-2" />
            <p className="text-xs font-medium text-slate-300">
              MP3 또는 WAV 오디오 파일을 이곳으로 드래그하거나 상단 버튼으로 선택하세요.
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              최대 50MB · 최대 15분 · 기본 22,050Hz 리샘플링 후 분석
            </p>
          </div>
        )}
      </div>

      {/* Range Selection Controls */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={useRegion}
              onChange={(e) => onToggleUseRegion(e.target.checked)}
              className="rounded border-slate-700 bg-slate-800 text-amber-500 focus:ring-0"
            />
            <span className="font-medium text-slate-200">구간 변환 / 10~30초 추천 탐색</span>
          </label>

          {useRegion && (
            <div className="flex items-center gap-2 font-mono tabular-nums text-xs">
              <span className="text-slate-400">구간:</span>
              <input
                type="number"
                min="0"
                max={Math.max(0, regionEnd - 1)}
                step="0.5"
                value={regionStart}
                onChange={(e) => onRegionChange(parseFloat(e.target.value) || 0, regionEnd)}
                className="w-16 rounded bg-slate-800 px-1.5 py-0.5 text-center text-slate-200 border border-slate-700"
              />
              <span>~</span>
              <input
                type="number"
                min={regionStart + 1}
                max={duration}
                step="0.5"
                value={regionEnd}
                onChange={(e) => onRegionChange(regionStart, parseFloat(e.target.value) || duration)}
                className="w-16 rounded bg-slate-800 px-1.5 py-0.5 text-center text-slate-200 border border-slate-700"
              />
              <span className="text-amber-400">({(regionEnd - regionStart).toFixed(1)}s 선택됨)</span>
            </div>
          )}
        </div>

        {/* AMT Guidance Note */}
        <div className="text-[11px] text-slate-400 italic">
          💡 MIDI는 원본 음색을 복제하지 않고 음높이(Pitch)·시작(Onset)·길이·세기를 기호화합니다.
        </div>
      </div>
    </div>
  );
};
