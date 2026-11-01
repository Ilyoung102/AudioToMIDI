import React, { useState } from 'react';
import { Sparkles, Play, Square, CheckCircle, Info, ArrowRight } from 'lucide-react';
import { CandidateExplorationData, CandidateResult, ConversionParams } from '../types/amt';
import { synth } from '../utils/synth';

interface CandidateExplorerProps {
  data: CandidateExplorationData | null;
  isLoading: boolean;
  onApplyConfig: (config: Partial<ConversionParams>) => void;
  onClose: () => void;
}

export const CandidateExplorer: React.FC<CandidateExplorerProps> = ({
  data,
  isLoading,
  onApplyConfig,
  onClose
}) => {
  const [playingCandId, setPlayingCandId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/95 p-6 text-center backdrop-blur-md">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-400 animate-spin">
          <Sparkles className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-semibold text-slate-100 mb-1">
          대표 구간(10~30초) 다각도 파라미터 후보 탐색 중...
        </h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          신경망 Onset/Frame 임계값과 음표 길이 조합을 비교하여 구조적 안정성과 무음 오검출을 분석하고 있습니다.
        </p>
      </div>
    );
  }

  if (!data) return null;

  const playCandidateNotes = (cand: CandidateResult) => {
    if (playingCandId === cand.id) {
      synth.allNotesOff();
      setPlayingCandId(null);
      return;
    }

    synth.allNotesOff();
    setPlayingCandId(cand.id);

    if (cand.sample_notes && cand.sample_notes.length > 0) {
      const startTime = cand.sample_notes[0].start;
      cand.sample_notes.forEach((note) => {
        const delay = (note.start - startTime) * 1000;
        const dur = note.duration;
        setTimeout(() => {
          synth.noteOn(note.pitch, note.velocity, dur);
        }, delay);
      });

      const lastNote = cand.sample_notes[cand.sample_notes.length - 1];
      const totalDur = (lastNote.end - startTime) * 1000 + 300;
      setTimeout(() => {
        setPlayingCandId(null);
      }, totalDur);
    }
  };

  return (
    <div className="rounded-xl border border-amber-500/30 bg-slate-900/95 p-5 shadow-lg backdrop-blur-md">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-bold text-slate-100">
              대표 구간 후보 탐색 & 맞춤 추천 ({data.total_candidates}개 설정 비교)
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            선택 구간: {data.window.start_sec.toFixed(1)}s ~ {data.window.end_sec.toFixed(1)}s ({data.window.duration_sec.toFixed(1)}초) · 전체 비교 소요: {data.total_elapsed_sec}초
          </p>
        </div>

        <button
          onClick={onClose}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700"
        >
          닫기
        </button>
      </div>

      {/* Top 3 Recommendations Box */}
      <div className="mb-4 rounded-lg bg-amber-500/10 border border-amber-500/25 p-3.5">
        <h4 className="text-xs font-semibold text-amber-300 mb-2 flex items-center gap-1.5">
          <CheckCircle className="h-4 w-4" />
          신호 특성 기반 상위 3개 추천 설정 (클릭 시 즉시 적용)
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {data.top_recommendations.map((rec) => (
            <div
              key={rec.candidate_id}
              className="flex flex-col justify-between rounded-lg bg-slate-900/80 p-3 border border-amber-500/20 hover:border-amber-500/50 transition-all cursor-pointer"
              onClick={() => onApplyConfig(rec.config)}
            >
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-slate-200">
                    #{rec.rank} {rec.name}
                  </span>
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-mono text-amber-400">
                    추천 {rec.rank}순위
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 line-clamp-2 leading-relaxed">
                  {rec.reason}
                </p>
              </div>

              <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-800 text-[11px]">
                <span className="text-slate-400 font-mono">
                  Onset {rec.config.onset_threshold} · Min {rec.config.min_note_len_ms}ms
                </span>
                <span className="flex items-center gap-1 text-amber-400 font-semibold hover:underline">
                  적용하기 <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Candidate Comparison Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/80 mb-3">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="border-b border-slate-800 bg-slate-900 text-[11px] font-medium text-slate-400">
            <tr>
              <th className="py-2.5 px-3">후보명</th>
              <th className="py-2.5 px-3">Onset / Frame</th>
              <th className="py-2.5 px-3">최소 길이 / 병합</th>
              <th className="py-2.5 px-3">검출 음표</th>
              <th className="py-2.5 px-3">음표 밀도</th>
              <th className="py-2.5 px-3">짧은 음 비율</th>
              <th className="py-2.5 px-3">무음 오검출</th>
              <th className="py-2.5 px-3">안정성 지수</th>
              <th className="py-2.5 px-3 text-right">미리듣기 / 적용</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
            {data.candidates.map((cand) => {
              const isPlaying = playingCandId === cand.id;
              const isTop = data.top_recommendations.some(r => r.candidate_id === cand.id);

              return (
                <tr
                  key={cand.id}
                  className={`hover:bg-slate-900/60 transition-colors ${isTop ? 'bg-amber-500/5' : ''}`}
                >
                  <td className="py-2 px-3 font-sans font-medium text-slate-200">
                    <div className="flex items-center gap-1.5">
                      {isTop && <span className="text-amber-400 text-xs">★</span>}
                      <span>{cand.name}</span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-slate-400">
                    {cand.onset_threshold.toFixed(2)} / {cand.frame_threshold.toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-slate-400">
                    {cand.min_len_ms}ms / {cand.merge_ms}ms
                  </td>
                  <td className="py-2 px-3 font-semibold text-slate-100">
                    {cand.note_count}개
                  </td>
                  <td className="py-2 px-3 text-slate-400">
                    {cand.notes_per_sec.toFixed(1)} /s
                  </td>
                  <td className="py-2 px-3 text-slate-400">
                    {(cand.short_note_ratio * 100).toFixed(1)}%
                  </td>
                  <td className="py-2 px-3 text-slate-400">
                    {(cand.silence_error_ratio * 100).toFixed(1)}%
                  </td>
                  <td className="py-2 px-3">
                    <span className="font-semibold text-amber-400">
                      {cand.quality_index.toFixed(1)}
                    </span>
                    <span className="text-[10px] text-slate-500"> / 100</span>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => playCandidateNotes(cand)}
                        className={`rounded px-2 py-1 text-[11px] font-sans font-medium transition-colors ${
                          isPlaying
                            ? 'bg-rose-500 text-white'
                            : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                        }`}
                      >
                        {isPlaying ? <Square className="h-3 w-3 inline mr-1" /> : <Play className="h-3 w-3 inline mr-1" />}
                        {isPlaying ? '정지' : '듣기'}
                      </button>
                      <button
                        onClick={() =>
                          onApplyConfig({
                            onset_threshold: cand.onset_threshold,
                            frame_threshold: cand.frame_threshold,
                            min_note_len_ms: cand.min_len_ms,
                            merge_tolerance_ms: cand.merge_ms
                          })
                        }
                        className="rounded bg-amber-500/20 border border-amber-500/40 px-2 py-1 text-[11px] font-sans font-semibold text-amber-300 hover:bg-amber-500/30"
                      >
                        선택
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Transparent Disclosure */}
      <div className="flex items-start gap-2 text-[11px] text-slate-400 bg-slate-950/40 p-2.5 rounded-lg border border-slate-800">
        <Info className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
        <p className="leading-relaxed">
          {data.scoring_formula_disclosure}
        </p>
      </div>
    </div>
  );
};
