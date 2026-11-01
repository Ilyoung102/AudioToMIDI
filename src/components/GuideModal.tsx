import React from 'react';
import { BookOpen, X, Music, CheckCircle, Info, Terminal, Settings } from 'lucide-react';

interface GuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GuideModal: React.FC<GuideModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <BookOpen className="h-5 w-5 text-amber-400" />
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                Audio2MIDI AMT 가이드 & 기술 매뉴얼
              </h3>
              <p className="text-[11px] text-slate-400">
                자동 음악 전사(Automatic Music Transcription)의 원리와 최적 변환 가이드
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs text-slate-300 leading-relaxed">
          {/* Important Core Concept */}
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4">
            <h4 className="font-semibold text-amber-300 text-sm mb-1 flex items-center gap-1.5">
              <Info className="h-4 w-4" />
              MIDI와 오디오 음색의 본질적 차이
            </h4>
            <p className="text-slate-300 leading-relaxed">
              <strong>MIDI(.mid)</strong>는 MP3나 WAV와 같은 오디오 파형(가수 목소리, 특정 악기 음색)을 복제·저장하는 파일이 아닙니다.
              연주자가 언제 건반을 눌렀는지(<strong>시작 시각, Onset</strong>), 어떤 음을 눌렀는지(<strong>음높이, Pitch</strong>),
              얼마나 길게 지속했는지(<strong>지속 시간, Duration</strong>), 그리고 얼마나 세게 쳤는지(<strong>세기, Velocity</strong>)를
              기록하는 <strong>수치 악보 데이터</strong>입니다. 다운로드한 MIDI는 DAW(로직, 큐베이스, 에이블톤 등)나 내장 피아노 신시사이저를 통해 원하는 모든 악기 음색으로 재연주할 수 있습니다.
            </p>
          </div>

          {/* 4 Conversion Modes */}
          <div>
            <h4 className="font-bold text-slate-100 text-sm mb-2.5 flex items-center gap-1.5">
              <Settings className="h-4 w-4 text-amber-400" />
              변환 모드별 최적화 전략
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="font-semibold text-amber-400 mb-1">A. 피아노 독주 (Piano Solo)</div>
                <p className="text-[11px] text-slate-400">
                  양손 연주와 화음(Polyphony)을 최대한 보존합니다. 페달 잔향으로 길어진 잔음과 실제 반복 타건을 구분하도록 Onset 임계값을 보수적으로 조율합니다.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="font-semibold text-amber-400 mb-1">B. 단일 악기 (Single Instrument)</div>
                <p className="text-[11px] text-slate-400">
                  플루트, 바이올린, 독주 어쿠스틱 기타 등 단일 멜로디 라인을 추출합니다. 악기 음역대(Tessitura) 필터를 활성화하여 고주파 잡음을 차단합니다.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="font-semibold text-amber-400 mb-1">C. 노래 주요 선율 (Lead Vocal)</div>
                <p className="text-[11px] text-slate-400">
                  단순히 가장 높은 음을 따는 것이 아니라 에너지와 선율 연속성을 추적합니다. 가창자의 바이브레이션(Vibrato)으로 음표가 잘게 부서지는 현상을 양자화 필터로 정제합니다.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="font-semibold text-amber-400 mb-1">D. 혼합 다성 음원 (Full Mix)</div>
                <p className="text-[11px] text-slate-400">
                  밴드나 반주가 겹친 음원에서 뚜렷한 유음정을 추출합니다. 드럼 스네어나 심벌즈 같은 비음정 타격음이 불필요한 음표로 오탐지되는 현상을 방지합니다.
                </p>
              </div>
            </div>
          </div>

          {/* Tips for Best Results */}
          <div>
            <h4 className="font-bold text-slate-100 text-sm mb-2 flex items-center gap-1.5">
              <CheckCircle className="h-4 w-4 text-emerald-400" />
              추천 설정 탐색 3단계 워크플로우
            </h4>
            <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
              <li>
                <strong>대표 구간 선택</strong>: 노래 전체를 곧바로 돌리기 전, 10~20초의 대표적인 연주/보컬 구간을 파형에서 선택합니다.
              </li>
              <li>
                <strong>추천 후보 탐색 클릭</strong>: 빠른(3), 균형(6), 정밀(12) 후보 중 하나를 선택하여 탐색을 실행하고, 객관적 안정성 점수와 미리듣기를 통해 최적 설정을 고릅니다.
              </li>
              <li>
                <strong>전체 곡 변환 및 피아노롤 미세 수정</strong>: 선택한 최적 설정을 전체 곡에 적용한 뒤, 피아노롤에서 잘못 검출된 노이즈 음표를 삭제하거나 박자를 정렬합니다.
              </li>
            </ol>
          </div>

          {/* Docker & Deployment */}
          <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
            <h4 className="font-bold text-slate-200 text-xs mb-2 flex items-center gap-1.5">
              <Terminal className="h-4 w-4 text-sky-400" />
              Docker Compose 실행 명령
            </h4>
            <pre className="p-2.5 rounded bg-slate-900 border border-slate-800 font-mono text-[11px] text-sky-300 overflow-x-auto">
{`# 1. 컨테이너 빌드 및 백그라운드 실행
docker-compose up -d --build

# 2. 실행 로그 확인
docker-compose logs -f

# 3. 브라우저에서 접속
http://localhost:3000`}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-slate-800 bg-slate-950 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            확인 및 닫기
          </button>
        </div>
      </div>
    </div>
  );
};
