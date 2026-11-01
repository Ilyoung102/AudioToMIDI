import React from 'react';
import {
  Play, Pause, Square, Repeat, Volume2, VolumeX, Radio, Music, Piano
} from 'lucide-react';
import { synth } from '../utils/synth';

interface PlaybackControllerProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStop: () => void;
  playbackMode: 'audio' | 'midi' | 'both';
  onChangePlaybackMode: (mode: 'audio' | 'midi' | 'both') => void;
  currentTime: number;
  duration: number;
  audioVolume: number;
  onChangeAudioVolume: (vol: number) => void;
  audioMuted: boolean;
  onToggleAudioMute: () => void;
  midiVolume: number;
  onChangeMidiVolume: (vol: number) => void;
  midiMuted: boolean;
  onToggleMidiMute: () => void;
  isLooping: boolean;
  onToggleLoop: () => void;
  hasMidi: boolean;
}

export const PlaybackController: React.FC<PlaybackControllerProps> = ({
  isPlaying,
  onTogglePlay,
  onStop,
  playbackMode,
  onChangePlaybackMode,
  currentTime,
  duration,
  audioVolume,
  onChangeAudioVolume,
  audioMuted,
  onToggleAudioMute,
  midiVolume,
  onChangeMidiVolume,
  midiMuted,
  onToggleMidiMute,
  isLooping,
  onToggleLoop,
  hasMidi
}) => {
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="sticky bottom-0 z-30 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/95 px-5 py-3 shadow-xl backdrop-blur-md">
      {/* Play, Stop, Loop Transport */}
      <div className="flex items-center gap-2">
        <button
          onClick={onTogglePlay}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500 text-slate-950 font-bold hover:bg-amber-400 transition-colors shadow-md shadow-amber-500/20 active:scale-95"
          title={isPlaying ? '일시정지 (Space)' : '재생 (Space)'}
        >
          {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current ml-0.5" />}
        </button>

        <button
          onClick={onStop}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          title="정지 및 모든 음 해제"
        >
          <Square className="h-4 w-4 fill-current" />
        </button>

        <button
          onClick={onToggleLoop}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
            isLooping
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
          }`}
          title="구간 반복 재생"
        >
          <Repeat className="h-4 w-4" />
        </button>

        {/* Time display */}
        <div className="ml-2 flex items-baseline gap-1 font-mono text-xs tabular-nums text-slate-200">
          <span className="font-semibold text-amber-400">{formatTime(currentTime)}</span>
          <span className="text-slate-500">/</span>
          <span className="text-slate-400">{formatTime(duration)}</span>
        </div>
      </div>

      {/* A-B Comparison Mode Switcher */}
      <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-1 border border-slate-800 text-xs">
        <button
          onClick={() => onChangePlaybackMode('audio')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
            playbackMode === 'audio'
              ? 'bg-slate-800 text-amber-400 font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Music className="h-3.5 w-3.5" />
          A: 원본 음원
        </button>

        <button
          onClick={() => onChangePlaybackMode('midi')}
          disabled={!hasMidi}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
            playbackMode === 'midi'
              ? 'bg-slate-800 text-amber-400 font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200 disabled:opacity-40'
          }`}
        >
          <Piano className="h-3.5 w-3.5" />
          B: 변환 MIDI
        </button>

        <button
          onClick={() => onChangePlaybackMode('both')}
          disabled={!hasMidi}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
            playbackMode === 'both'
              ? 'bg-slate-800 text-amber-400 font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200 disabled:opacity-40'
          }`}
        >
          <Radio className="h-3.5 w-3.5" />
          A+B 동시 비교
        </button>
      </div>

      {/* Volume Controls & Panic */}
      <div className="flex items-center gap-4 text-xs">
        {/* Audio Volume */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onToggleAudioMute}
            className="text-slate-400 hover:text-slate-200"
            title="원본 볼륨 음소거"
          >
            {audioMuted || audioVolume === 0 ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <span className="text-[11px] text-slate-400">오디오:</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={audioMuted ? 0 : audioVolume}
            onChange={(e) => onChangeAudioVolume(parseFloat(e.target.value))}
            className="w-16 accent-amber-500"
          />
        </div>

        {/* MIDI Synth Volume */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onToggleMidiMute}
            disabled={!hasMidi}
            className="text-slate-400 hover:text-slate-200 disabled:opacity-40"
            title="MIDI 음소거"
          >
            {midiMuted || midiVolume === 0 ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <span className="text-[11px] text-slate-400">MIDI:</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            disabled={!hasMidi}
            value={midiMuted ? 0 : midiVolume}
            onChange={(e) => onChangeMidiVolume(parseFloat(e.target.value))}
            className="w-16 accent-amber-500 disabled:opacity-40"
          />
        </div>

        {/* Panic: All Notes Off */}
        <button
          onClick={() => synth.allNotesOff()}
          className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:bg-slate-700"
          title="모든 재생 음 강제 소음 (Panic)"
        >
          All Notes Off
        </button>
      </div>
    </div>
  );
};
