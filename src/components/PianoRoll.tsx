import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  ZoomIn, ZoomOut, Undo2, Redo2, Plus, Trash2, ArrowUp, ArrowDown,
  Save, Play, Square, Scissors, SlidersHorizontal, Check, RefreshCw
} from 'lucide-react';
import { NoteEvent } from '../types/amt';
import { synth } from '../utils/synth';

interface PianoRollProps {
  notes: NoteEvent[];
  onChangeNotes: (notes: NoteEvent[]) => void;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onSeek: (time: number) => void;
  bpm: number;
  onSaveEditedMidi: () => void;
  isSavingMidi: boolean;
}

const PIANO_KEY_WIDTH = 56;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK_KEYS = [1, 3, 6, 8, 10]; // C#, D#, F#, G#, A#

export const PianoRoll: React.FC<PianoRollProps> = ({
  notes,
  onChangeNotes,
  currentTime,
  duration,
  isPlaying,
  onSeek,
  bpm,
  onSaveEditedMidi,
  isSavingMidi
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Viewport & Zoom State
  const [pixelsPerSecond, setPixelsPerSecond] = useState(80); // time zoom (50 ~ 300)
  const [noteHeight, setNoteHeight] = useState(14); // pitch zoom (10 ~ 24)
  const [scrollX, setScrollX] = useState(0);
  const [scrollY, setScrollY] = useState(500); // scrolled to middle octaves (C3-C5)

  // Selection & History State
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [history, setHistory] = useState<NoteEvent[][]>([notes]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Drag interaction state
  const [dragState, setDragState] = useState<{
    type: 'move' | 'resize' | 'create' | 'pan';
    noteId?: string;
    startX: number;
    startY: number;
    origStart?: number;
    origEnd?: number;
    origPitch?: number;
    createdNote?: NoteEvent;
  } | null>(null);

  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);
  const [gridDivision, setGridDivision] = useState<number>(4); // 4 = 1/16 note

  // Pitch range: MIDI 21 (A0) to 108 (C8)
  const MIN_PITCH = 21;
  const MAX_PITCH = 108;
  const TOTAL_KEYS = MAX_PITCH - MIN_PITCH + 1;
  const TOTAL_HEIGHT = TOTAL_KEYS * noteHeight;

  // Commit history on user modification
  const pushHistory = useCallback((newNotes: NoteEvent[]) => {
    const updatedHistory = history.slice(0, historyIndex + 1);
    updatedHistory.push(newNotes);
    if (updatedHistory.length > 30) updatedHistory.shift();
    setHistory(updatedHistory);
    setHistoryIndex(updatedHistory.length - 1);
    onChangeNotes(newNotes);
  }, [history, historyIndex, onChangeNotes]);

  const undo = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      onChangeNotes(prev);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      onChangeNotes(next);
    }
  };

  // Keep history initialized
  useEffect(() => {
    if (history.length === 1 && history[0].length === 0 && notes.length > 0) {
      setHistory([notes]);
      setHistoryIndex(0);
      // Auto scroll viewport to pitch centroid
      if (notes.length > 0) {
        const avgPitch = notes.reduce((sum, n) => sum + n.pitch, 0) / notes.length;
        const targetY = (MAX_PITCH - avgPitch) * noteHeight - 150;
        setScrollY(Math.max(0, targetY));
      }
    }
  }, [notes]);

  // Main Canvas Rendering Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const totalDuration = Math.max(duration, 15);
    const totalWidth = totalDuration * pixelsPerSecond;

    // 1. Draw Background Pitch Rows
    for (let p = MAX_PITCH; p >= MIN_PITCH; p--) {
      const y = (MAX_PITCH - p) * noteHeight - scrollY;
      if (y + noteHeight < 0 || y > height) continue;

      const semitone = p % 12;
      const isBlack = BLACK_KEYS.includes(semitone);
      const isC = semitone === 0;

      // Pitch background
      if (isBlack) {
        ctx.fillStyle = '#0b0f19';
      } else {
        ctx.fillStyle = isC ? '#151d2f' : '#0f172a';
      }
      ctx.fillRect(PIANO_KEY_WIDTH, y, width - PIANO_KEY_WIDTH, noteHeight);

      // Pitch horizontal divider line
      ctx.strokeStyle = isC ? '#334155' : '#1e293b';
      ctx.lineWidth = isC ? 1.5 : 0.8;
      ctx.beginPath();
      ctx.moveTo(PIANO_KEY_WIDTH, y + noteHeight);
      ctx.lineTo(width, y + noteHeight);
      ctx.stroke();
    }

    // 2. Draw Vertical Beat & Second Grid Lines
    const beatSec = 60.0 / Math.max(40, bpm);
    const subBeatSec = beatSec / gridDivision;
    const firstSubBeat = Math.floor(scrollX / (subBeatSec * pixelsPerSecond));
    const lastSubBeat = Math.ceil((scrollX + width) / (subBeatSec * pixelsPerSecond));

    for (let i = firstSubBeat; i <= lastSubBeat; i++) {
      const t = i * subBeatSec;
      const x = PIANO_KEY_WIDTH + t * pixelsPerSecond - scrollX;
      if (x < PIANO_KEY_WIDTH || x > width) continue;

      const isMeasure = i % (gridDivision * 4) === 0;
      const isBeat = i % gridDivision === 0;

      ctx.strokeStyle = isMeasure ? '#334155' : isBeat ? '#1e293b' : '#131b2c';
      ctx.lineWidth = isMeasure ? 1.2 : 0.8;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      if (isMeasure) {
        ctx.fillStyle = '#64748b';
        ctx.font = '9px JetBrains Mono, monospace';
        const measureNum = Math.floor(i / (gridDivision * 4)) + 1;
        ctx.fillText(`M${measureNum} (${t.toFixed(1)}s)`, x + 4, 12);
      }
    }

    // 3. Render MIDI Note Blocks
    notes.forEach((note) => {
      const x = PIANO_KEY_WIDTH + note.start * pixelsPerSecond - scrollX;
      const w = Math.max(3, note.duration * pixelsPerSecond);
      const y = (MAX_PITCH - note.pitch) * noteHeight - scrollY;

      // Culling outside visible area
      if (x + w < PIANO_KEY_WIDTH || x > width || y + noteHeight < 0 || y > height) {
        return;
      }

      const isSelected = selectedNoteId === note.id;

      // Velocity-based color mapping
      const velRatio = Math.max(0.1, Math.min(1.0, note.velocity / 127.0));
      // Hues: 180 (cyan/soft) to 42 (warm amber/orange)
      if (isSelected) {
        ctx.fillStyle = '#38bdf8';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
      } else {
        const r = Math.round(245 * velRatio + 30 * (1 - velRatio));
        const g = Math.round(158 * velRatio + 140 * (1 - velRatio));
        const b = Math.round(11 * velRatio + 200 * (1 - velRatio));
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
        ctx.lineWidth = 1;
      }

      // Rounded rectangle for note block
      const radius = 2;
      ctx.beginPath();
      ctx.roundRect(x, y + 1, w, noteHeight - 2, radius);
      ctx.fill();
      ctx.stroke();

      // Right resize handle bar
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.fillRect(x + w - 4, y + 1, 4, noteHeight - 2);

      // Label inside note if wide enough
      if (w > 26) {
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.fillText(note.pitch_name, x + 3, y + noteHeight - 4);
      }
    });

    // 4. Render Piano Keyboard on Left
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, PIANO_KEY_WIDTH, height);

    for (let p = MAX_PITCH; p >= MIN_PITCH; p--) {
      const y = (MAX_PITCH - p) * noteHeight - scrollY;
      if (y + noteHeight < 0 || y > height) continue;

      const semitone = p % 12;
      const isBlack = BLACK_KEYS.includes(semitone);
      const isC = semitone === 0;

      // Key body
      if (isBlack) {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, y + 1, PIANO_KEY_WIDTH - 12, noteHeight - 2);
      } else {
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, y + 1, PIANO_KEY_WIDTH - 2, noteHeight - 2);
      }

      // Key separator
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, y + 1, isBlack ? PIANO_KEY_WIDTH - 12 : PIANO_KEY_WIDTH - 2, noteHeight - 2);

      // C Octave labels
      if (isC) {
        const octave = Math.floor(p / 12) - 1;
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.fillText(`C${octave}`, 6, y + noteHeight - 4);
      }
    }

    // Border separating keyboard from grid
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PIANO_KEY_WIDTH, 0);
    ctx.lineTo(PIANO_KEY_WIDTH, height);
    ctx.stroke();

    // 5. Render Synchronized Playhead Line
    const playX = PIANO_KEY_WIDTH + currentTime * pixelsPerSecond - scrollX;
    if (playX >= PIANO_KEY_WIDTH && playX <= width) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, height);
      ctx.stroke();

      // Top red cap
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(playX - 5, 0);
      ctx.lineTo(playX + 5, 0);
      ctx.lineTo(playX, 10);
      ctx.closePath();
      ctx.fill();
    }
  }, [notes, selectedNoteId, scrollX, scrollY, pixelsPerSecond, noteHeight, currentTime, duration, bpm, gridDivision]);

  // Coordinate Converters
  const xToTime = (x: number) => Math.max(0, (x - PIANO_KEY_WIDTH + scrollX) / pixelsPerSecond);
  const yToPitch = (y: number) => {
    const rawPitch = MAX_PITCH - Math.floor((y + scrollY) / noteHeight);
    return Math.max(MIN_PITCH, Math.min(MAX_PITCH, rawPitch));
  };

  const quantizeTime = (t: number) => {
    if (!snapToGrid) return t;
    const beatSec = 60.0 / Math.max(40, bpm);
    const step = beatSec / gridDivision;
    return Math.round(t / step) * step;
  };

  // Canvas Mouse Down
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    // Clicking on Piano Key on left
    if (clientX < PIANO_KEY_WIDTH) {
      const pitch = yToPitch(clientY);
      synth.noteOn(pitch, 90, 0.4);
      return;
    }

    const clickTime = xToTime(clientX);
    const clickPitch = yToPitch(clientY);

    // Right Click to Delete
    if (e.button === 2) {
      e.preventDefault();
      const hit = notes.find(
        (n) => n.pitch === clickPitch && clickTime >= n.start && clickTime <= n.end
      );
      if (hit) {
        pushHistory(notes.filter((n) => n.id !== hit.id));
        if (selectedNoteId === hit.id) setSelectedNoteId(null);
      }
      return;
    }

    // Check hit on existing note
    const hitNote = notes.find(
      (n) => n.pitch === clickPitch && clickTime >= n.start && clickTime <= n.end
    );

    if (hitNote) {
      setSelectedNoteId(hitNote.id);
      synth.noteOn(hitNote.pitch, hitNote.velocity, 0.3);

      const noteRightEdgeX = PIANO_KEY_WIDTH + hitNote.end * pixelsPerSecond - scrollX;
      const isEdgeResize = Math.abs(clientX - noteRightEdgeX) < 8;

      if (isEdgeResize) {
        setDragState({
          type: 'resize',
          noteId: hitNote.id,
          startX: clientX,
          startY: clientY,
          origStart: hitNote.start,
          origEnd: hitNote.end
        });
      } else {
        setDragState({
          type: 'move',
          noteId: hitNote.id,
          startX: clientX,
          startY: clientY,
          origStart: hitNote.start,
          origEnd: hitNote.end,
          origPitch: hitNote.pitch
        });
      }
    } else {
      // Empty grid click -> Create new note
      const startTime = quantizeTime(clickTime);
      const beatSec = 60.0 / Math.max(40, bpm);
      const defaultDur = beatSec / gridDivision;
      const newNote: NoteEvent = {
        id: `custom_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
        pitch: clickPitch,
        pitch_name: `${NOTE_NAMES[clickPitch % 12]}${Math.floor(clickPitch / 12) - 1}`,
        start: startTime,
        end: startTime + defaultDur,
        duration: defaultDur,
        velocity: 85
      };

      synth.noteOn(clickPitch, 85, 0.3);
      setSelectedNoteId(newNote.id);
      const nextNotes = [...notes, newNote];
      pushHistory(nextNotes);

      setDragState({
        type: 'resize',
        noteId: newNote.id,
        startX: clientX,
        startY: clientY,
        origStart: newNote.start,
        origEnd: newNote.end
      });
    }
  };

  // Canvas Mouse Move
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragState || !dragState.noteId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const dx = clientX - dragState.startX;
    const dt = dx / pixelsPerSecond;

    if (dragState.type === 'resize' && dragState.origStart !== undefined) {
      const newEnd = Math.max(dragState.origStart + 0.04, quantizeTime((dragState.origEnd || 0) + dt));
      const updated = notes.map((n) => {
        if (n.id === dragState.noteId) {
          const dur = Math.max(0.04, newEnd - n.start);
          return { ...n, end: newEnd, duration: dur };
        }
        return n;
      });
      onChangeNotes(updated);
    } else if (dragState.type === 'move' && dragState.origStart !== undefined && dragState.origPitch !== undefined) {
      const newStart = Math.max(0, quantizeTime(dragState.origStart + dt));
      const dur = (dragState.origEnd || 0) - dragState.origStart;
      const newPitch = yToPitch(clientY);

      const updated = notes.map((n) => {
        if (n.id === dragState.noteId) {
          return {
            ...n,
            start: newStart,
            end: newStart + dur,
            pitch: newPitch,
            pitch_name: `${NOTE_NAMES[newPitch % 12]}${Math.floor(newPitch / 12) - 1}`
          };
        }
        return n;
      });
      onChangeNotes(updated);
    }
  };

  const handleMouseUp = () => {
    if (dragState) {
      pushHistory(notes);
      setDragState(null);
    }
  };

  // Batch note modifiers
  const selectedNote = notes.find((n) => n.id === selectedNoteId);

  const deleteSelected = () => {
    if (!selectedNoteId) return;
    pushHistory(notes.filter((n) => n.id !== selectedNoteId));
    setSelectedNoteId(null);
  };

  const shiftOctave = (deltaOctaves: number) => {
    const shift = deltaOctaves * 12;
    const updated = notes.map((n) => {
      if (selectedNoteId && n.id !== selectedNoteId) return n;
      const p = Math.max(MIN_PITCH, Math.min(MAX_PITCH, n.pitch + shift));
      return {
        ...n,
        pitch: p,
        pitch_name: `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 1}`
      };
    });
    pushHistory(updated);
  };

  const quantizeAll = () => {
    const beatSec = 60.0 / Math.max(40, bpm);
    const step = beatSec / gridDivision;
    const updated = notes.map((n) => {
      const qStart = Math.round(n.start / step) * step;
      const qEnd = Math.max(qStart + step, Math.round(n.end / step) * step);
      return { ...n, start: qStart, end: qEnd, duration: qEnd - qStart };
    });
    pushHistory(updated);
  };

  return (
    <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-900 shadow-sm overflow-hidden">
      {/* Piano Roll Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800 bg-slate-950 px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-200">피아노롤 편집기</span>
          <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-slate-400">
            총 {notes.length}개 음표
          </span>

          {selectedNote && (
            <div className="flex items-center gap-2 font-mono text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded border border-amber-500/20">
              <span className="font-bold">{selectedNote.pitch_name}</span>
              <span>·</span>
              <span>{selectedNote.start.toFixed(2)}s ~ {selectedNote.end.toFixed(2)}s</span>
              <span>·</span>
              <span>Vel: {selectedNote.velocity}</span>
            </div>
          )}
        </div>

        {/* Action Buttons & Tools */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Undo / Redo */}
          <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700">
            <button
              onClick={undo}
              disabled={historyIndex <= 0}
              title="실행 취소 (Undo)"
              className="p-1 rounded text-slate-300 hover:text-white disabled:opacity-40"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={redo}
              disabled={historyIndex >= history.length - 1}
              title="다시 실행 (Redo)"
              className="p-1 rounded text-slate-300 hover:text-white disabled:opacity-40"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Grid Snap & Division */}
          <div className="flex items-center gap-1.5 bg-slate-800/80 px-2 py-1 rounded-lg border border-slate-700/60">
            <label className="flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={snapToGrid}
                onChange={(e) => setSnapToGrid(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-amber-500"
              />
              <span>스냅</span>
            </label>
            <select
              value={gridDivision}
              onChange={(e) => setGridDivision(parseInt(e.target.value, 10))}
              className="bg-slate-900 text-[11px] text-slate-200 rounded px-1.5 py-0.5 border border-slate-700"
            >
              <option value="1">1/4 (4분음)</option>
              <option value="2">1/8 (8분음)</option>
              <option value="4">1/16 (16분음)</option>
              <option value="8">1/32 (32분음)</option>
            </select>
          </div>

          {/* Batch Tools */}
          <button
            onClick={quantizeAll}
            className="flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700 border border-slate-700"
          >
            전체 퀀타이즈
          </button>

          <button
            onClick={() => shiftOctave(1)}
            title="선택 음 또는 전체 음 1옥타브 올리기 (+12)"
            className="flex items-center gap-0.5 rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700 border border-slate-700"
          >
            <ArrowUp className="h-3 w-3" /> +1 Oct
          </button>
          <button
            onClick={() => shiftOctave(-1)}
            title="선택 음 또는 전체 음 1옥타브 내리기 (-12)"
            className="flex items-center gap-0.5 rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700 border border-slate-700"
          >
            <ArrowDown className="h-3 w-3" /> -1 Oct
          </button>

          {selectedNoteId && (
            <button
              onClick={deleteSelected}
              className="flex items-center gap-1 rounded bg-rose-500/20 text-rose-300 px-2 py-1 text-[11px] hover:bg-rose-500/30 border border-rose-500/40"
            >
              <Trash2 className="h-3 w-3" /> 삭제
            </button>
          )}

          {/* Zoom controls */}
          <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700">
            <button
              onClick={() => setPixelsPerSecond(Math.max(40, pixelsPerSecond - 20))}
              title="시간 축 축소"
              className="p-1 text-slate-300 hover:text-white"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setPixelsPerSecond(Math.min(240, pixelsPerSecond + 20))}
              title="시간 축 확대"
              className="p-1 text-slate-300 hover:text-white"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Save Edited MIDI Button */}
          <button
            onClick={onSaveEditedMidi}
            disabled={isSavingMidi || notes.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-3 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 transition-colors"
          >
            {isSavingMidi ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            수정 MIDI 저장
          </button>
        </div>
      </div>

      {/* Piano Roll Canvas Viewport */}
      <div
        ref={containerRef}
        className="relative h-[420px] w-full overflow-hidden bg-slate-950 select-none cursor-crosshair"
        onContextMenu={(e) => e.preventDefault()}
        onWheel={(e) => {
          if (e.shiftKey) {
            // Horizontal scroll
            setScrollX(Math.max(0, scrollX + e.deltaY));
          } else {
            // Vertical pitch scroll
            setScrollY(Math.max(0, Math.min(TOTAL_HEIGHT - 200, scrollY + e.deltaY)));
          }
        }}
      >
        <canvas
          ref={canvasRef}
          width={1280}
          height={420}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className="h-full w-full block"
        />

        {notes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-xs pointer-events-none">
            변환을 실행하면 추출된 MIDI 음표가 이곳 피아노롤에 표시됩니다.
          </div>
        )}
      </div>

      {/* Velocity / Scrollbar bottom strip */}
      <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950 px-4 py-2 text-[11px] text-slate-400">
        <div className="flex items-center gap-3">
          <span>마우스 조작:</span>
          <span className="text-slate-300">클릭·드래그: 음표 생성/이동</span>
          <span>·</span>
          <span className="text-slate-300">오른쪽 모서리 드래그: 길이 조절</span>
          <span>·</span>
          <span className="text-slate-300">우클릭: 삭제</span>
          <span>·</span>
          <span className="text-slate-300">왼쪽 건반 클릭: 음고 미리듣기</span>
        </div>

        {selectedNote && (
          <div className="flex items-center gap-2">
            <span>세기 (Velocity):</span>
            <input
              type="range"
              min="1"
              max="127"
              value={selectedNote.velocity}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                const updated = notes.map((n) => (n.id === selectedNote.id ? { ...n, velocity: val } : n));
                onChangeNotes(updated);
              }}
              className="w-24 accent-amber-500"
            />
            <span className="font-mono text-amber-400 w-8">{selectedNote.velocity}</span>
          </div>
        )}
      </div>
    </div>
  );
};
