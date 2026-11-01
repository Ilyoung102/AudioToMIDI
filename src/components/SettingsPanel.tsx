import React, { useState } from 'react';
import { Sliders, HelpCircle, ChevronDown, ChevronUp, Music2, Mic, Piano, Layers } from 'lucide-react';
import { ConversionParams } from '../types/amt';

interface SettingsPanelProps {
  params: ConversionParams;
  onChange: (newParams: ConversionParams) => void;
  estimatedBpm?: number;
  isProcessing: boolean;
  onExploreCandidates: () => void;
  onStartConversion: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  params,
  onChange,
  estimatedBpm,
  isProcessing,
  onExploreCandidates,
  onStartConversion
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const updateParam = <K extends keyof ConversionParams>(key: K, value: ConversionParams[K]) => {
    onChange({ ...params, [key]: value });
  };

  const modes = [
    {
      id: 'piano_solo',
      label: '피아노 독주',
      sub: '양손 연주·화음 보존',
      icon: Piano,
      desc: '화음 및 지속음을 유지하며 페달 잔향과 반복 타건을 구분합니다.'
    },
    {
      id: 'single_instrument',
      label: '단일 악기',
      sub: '기타·플루트·바이올린',
      icon: Music2,
      desc: '단독 선율 악기의 분리된 멜로디 라인을 주파수 대역에 맞춰 추출합니다.'
    },
    {
      id: 'lead_vocal',
      label: '노래 주요 선율',
      sub: '가창 보컬·주선율',
      icon: Mic,
      desc: '에너지와 피치 연속성 기반으로 보컬 선율을 추적하며 비브라토를 안정화합니다.'
    },
    {
      id: 'full_mix',
      label: '혼합 다성 음원',
      sub: '밴드 앙상블·반주',
      icon: Layers,
      desc: '여러 악기가 중첩된 상태에서 검출된 유음정을 추출하며 타악기 노이즈를 억제합니다.'
    }
  ] as const;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 shadow-sm backdrop-blur-sm">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-amber-400" />
          <h2 className="text-sm font-semibold text-slate-100">전사 파라미터 & 변환 설정</h2>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onExploreCandidates}
            disabled={isProcessing}
            className="rounded-lg bg-amber-500/15 border border-amber-500/30 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/25 transition-colors"
          >
            🔍 대표 구간 추천 후보 탐색
          </button>
          <button
            onClick={onStartConversion}
            disabled={isProcessing}
            className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors shadow-sm disabled:opacity-50"
          >
            {isProcessing ? '처리 중...' : '전체 곡 MIDI 변환 실행'}
          </button>
        </div>
      </div>

      {/* Mode Selection Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
        {modes.map((m) => {
          const Icon = m.icon;
          const isSelected = params.mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => {
                let adjusted = { ...params, mode: m.id as any };
                if (m.id === 'piano_solo') {
                  adjusted.onset_threshold = 0.50;
                  adjusted.frame_threshold = 0.30;
                  adjusted.min_note_len_ms = 58;
                  adjusted.min_pitch = 21; // A0
                  adjusted.max_pitch = 108; // C8
                } else if (m.id === 'lead_vocal') {
                  adjusted.onset_threshold = 0.60;
                  adjusted.frame_threshold = 0.40;
                  adjusted.min_note_len_ms = 85;
                  adjusted.vibrato_quantize = true;
                  adjusted.min_pitch = 48; // C3
                  adjusted.max_pitch = 84; // C6
                } else if (m.id === 'single_instrument') {
                  adjusted.onset_threshold = 0.45;
                  adjusted.frame_threshold = 0.28;
                  adjusted.min_note_len_ms = 50;
                } else {
                  adjusted.onset_threshold = 0.55;
                  adjusted.frame_threshold = 0.35;
                  adjusted.min_note_len_ms = 60;
                }
                onChange(adjusted);
              }}
              className={`flex flex-col text-left p-3 rounded-lg border transition-all ${
                isSelected
                  ? 'border-amber-500/60 bg-amber-500/10 text-slate-100 shadow-sm'
                  : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`h-4 w-4 ${isSelected ? 'text-amber-400' : 'text-slate-400'}`} />
                <span className="text-xs font-semibold">{m.label}</span>
              </div>
              <span className="text-[11px] text-slate-400 mb-1">{m.sub}</span>
              <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed">{m.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Basic Settings Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-lg bg-slate-950/40 border border-slate-800/80 mb-3">
        {/* Preset search depth */}
        <div>
          <label className="text-xs font-medium text-slate-300 block mb-1">
            후보 탐색 정밀도
          </label>
          <div className="grid grid-cols-3 gap-1 bg-slate-800/60 p-1 rounded-md border border-slate-700/60 text-xs text-center">
            {(['fast', 'balanced', 'detailed'] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => updateParam('search_preset', lvl)}
                className={`py-1 rounded font-medium transition-colors ${
                  params.search_preset === lvl
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {lvl === 'fast' ? '빠르게 (3)' : lvl === 'balanced' ? '균형 (6)' : '정밀 (12)'}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            구간 비교 시 생성할 파라미터 조합 수
          </p>
        </div>

        {/* Quantize Grid */}
        <div>
          <label className="text-xs font-medium text-slate-300 block mb-1">
            박자 정렬 (Quantize)
          </label>
          <select
            value={params.quantize_grid}
            onChange={(e) => updateParam('quantize_grid', e.target.value as any)}
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 focus:outline-none"
          >
            <option value="none">원래 연주 타이밍 유지 (No Quantize)</option>
            <option value="1/4">1/4 박 (Quarter Note)</option>
            <option value="1/8">1/8 박 (8th Note)</option>
            <option value="1/16">1/16 박 (16th Note)</option>
            <option value="triplet">셋잇단음표 (Triplet)</option>
          </select>
          <p className="text-[10px] text-slate-400 mt-1">
            기본은 연주자의 뉘앙스·루바토를 그대로 보존합니다.
          </p>
        </div>

        {/* Vocal Vibrato / Lead Treatment */}
        <div>
          <label className="text-xs font-medium text-slate-300 block mb-1">
            보컬 비브라토 처리
          </label>
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={() => updateParam('vibrato_quantize', !params.vibrato_quantize)}
              className={`flex-1 py-1.5 px-2 rounded-md border text-xs font-medium transition-colors ${
                params.vibrato_quantize
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
            >
              {params.vibrato_quantize ? '✓ 반음 단위 음표로 안정화' : '피치 떨림 원형 보존'}
            </button>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            가창 떨림으로 인해 잘게 쪼개지는 잔음표를 방지합니다.
          </p>
        </div>
      </div>

      {/* Advanced Toggle */}
      <div>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
        >
          {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          고급 신경망 파라미터 및 신호처리 필터 {showAdvanced ? '접기' : '펼치기'}
        </button>

        {showAdvanced && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-lg bg-slate-950/70 border border-slate-800 text-xs">
            {/* Onset Threshold */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-slate-300">Onset 민감도 임계값</span>
                <span className="font-mono text-amber-400">{params.onset_threshold.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.10"
                max="0.90"
                step="0.05"
                value={params.onset_threshold}
                onChange={(e) => updateParam('onset_threshold', parseFloat(e.target.value))}
                className="w-full accent-amber-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                낮출수록 미세 타건을 더 많이 찾지만 불필요한 음표도 증가합니다.
              </p>
            </div>

            {/* Frame Threshold */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-slate-300">Frame 지속음 임계값</span>
                <span className="font-mono text-amber-400">{params.frame_threshold.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.10"
                max="0.80"
                step="0.05"
                value={params.frame_threshold}
                onChange={(e) => updateParam('frame_threshold', parseFloat(e.target.value))}
                className="w-full accent-amber-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                음표의 울림이 지속되는 구간을 판단하는 임계값입니다.
              </p>
            </div>

            {/* Min Note Length */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-slate-300">최소 음표 길이</span>
                <span className="font-mono text-amber-400">{params.min_note_len_ms} ms</span>
              </div>
              <input
                type="range"
                min="30"
                max="250"
                step="5"
                value={params.min_note_len_ms}
                onChange={(e) => updateParam('min_note_len_ms', parseInt(e.target.value, 10))}
                className="w-full accent-amber-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                이 값보다 짧은 파편적 잔음은 자동으로 필터링합니다.
              </p>
            </div>

            {/* Merge tolerance */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-slate-300">동일 음 병합 간격</span>
                <span className="font-mono text-amber-400">{params.merge_tolerance_ms} ms</span>
              </div>
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={params.merge_tolerance_ms}
                onChange={(e) => updateParam('merge_tolerance_ms', parseInt(e.target.value, 10))}
                className="w-full accent-amber-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                가까운 동일 음을 이어주되 빠른 반복 타건은 보존합니다.
              </p>
            </div>

            {/* Min/Max Pitch range */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-slate-300">MIDI 음역 제한</span>
                <span className="font-mono text-amber-400">{params.min_pitch} ~ {params.max_pitch}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max={params.max_pitch - 1}
                  value={params.min_pitch}
                  onChange={(e) => updateParam('min_pitch', parseInt(e.target.value, 10) || 0)}
                  className="w-16 rounded bg-slate-800 px-2 py-1 text-slate-200 border border-slate-700"
                />
                <span className="text-slate-500">~</span>
                <input
                  type="number"
                  min={params.min_pitch + 1}
                  max="127"
                  value={params.max_pitch}
                  onChange={(e) => updateParam('max_pitch', parseInt(e.target.value, 10) || 127)}
                  className="w-16 rounded bg-slate-800 px-2 py-1 text-slate-200 border border-slate-700"
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                악기 음역 외 비정상 배음 고주파나 럼블 저주파를 차단합니다.
              </p>
            </div>

            {/* Octave Correction */}
            <div>
              <span className="font-medium text-slate-300 block mb-1">옥타브 배음 오류 보정</span>
              <label className="flex items-center gap-2 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={params.octave_correction}
                  onChange={(e) => updateParam('octave_correction', e.target.checked)}
                  className="rounded border-slate-700 bg-slate-800 text-amber-500 focus:ring-0"
                />
                <span className="text-slate-300 text-xs">옥타브 상/하 약한 고스트 음 감쇄</span>
              </label>
              <p className="text-[10px] text-slate-400 mt-1">
                강한 기본음에 이끌려 생긴 상하 옥타브 가짜 음표를 억제합니다.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
