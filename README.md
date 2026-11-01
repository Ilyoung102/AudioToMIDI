# Audio2MIDI Studio (오디오-MIDI 전사기 워크스테이션)

> **Spotify Basic Pitch 신경망 모델**과 정밀 오디오 신호처리(librosa, pretty_midi) 기반의 MP3/WAV 오디오 to MIDI 변환 및 대화형 피아노롤 편집 워크스테이션

---

## 1. 개요 및 핵심 아키텍처

Audio2MIDI Studio는 MP3/WAV 음원을 업로드하여 실제 MIDI 음표 데이터(음높이·시작·지속시간·벨로시티)로 변환하고, 웹 오디오 피아노 신시사이저를 통한 원본/MIDI 동기화 A-B 비교 청취 및 캔버스 피아노롤 편집을 지원하는 풀스택 AMT(Automatic Music Transcription) 시스템입니다.

### 핵심 개념 공지
> **MIDI는 원본 MP3 음색을 복제하는 파일이 아닙니다.**
> 연주자가 언제 건반을 눌렀는지(시작 시각, Onset), 어떤 음을 눌렀는지(음높이, Pitch), 얼마나 길게 지속했는지(Duration), 그리고 얼마나 세게 쳤는지(Velocity)를 기록하는 수치 악보 데이터입니다.

---

## 2. 변환 파이프라인 (Data Pipeline)

```
[MP3/WAV 업로드 / 데모 샘플]
          ↓
 1. 파일 검사 (확장자, 채널, 샘플레이트, 무음 비율, RMS dB, 클리핑 감지)
          ↓
 2. 오디오 전처리 (22,050Hz 리샘플링, 피크 정규화, 로우컷/하이컷, 노이즈 게이트)
          ↓
 3. 모델 추론 (Spotify Basic Pitch ICASSP 2022 nmp.tflite)
          ↓
 4. 음표 후처리 (Onset/Frame 필터, 최소 음 길이 정제, 동일 음 병합, 옥타브 배음 보정, 비브라토 안정화)
          ↓
 5. MIDI 생성 & 왕복 검증 (pretty_midi Type 0/1 생성, 재파싱 타이밍 편차 < 10ms 검증)
          ↓
 6. 피아노롤 편집 & A-B 동기화 청취 & 데이터 패키지 다운로드
```

---

## 3. 지원 변환 모드

| 변환 모드 | 타겟 음원 특성 | 주요 파라미터 최적화 |
| :--- | :--- | :--- |
| **A. 피아노 독주 (Piano Solo)** | 화음(Polyphony) 및 양손 연주 | A0(21)~C8(108) 전음역 허용, 잔향/타건 분리, 페달 잔음 보존 |
| **B. 단일 악기 (Single Instrument)** | 기타, 플루트, 바이올린 독주 선율 | 단음 중심, 악기별 권장 음역대 필터링으로 비정상 고주파 배음 차단 |
| **C. 노래 주요 선율 (Lead Vocal)** | 가창 보컬 선율 | 에너지 및 피치 연속성 추적, 가창 비브라토(바이브레이션) 반음 양자화 |
| **D. 혼합 다성 음원 (Full Mix)** | 밴드 앙상블, 다성 혼합 음원 | 유음정 중심 검출, 드럼·타악기 어택음의 거짓 음표(False Note) 억제 |

---

## 4. 모델 사양 및 출처

- **모델명**: Spotify Basic Pitch (ICASSP 2022)
- **논문**: *"A Lightweight Instrument-Agnostic Neural Network for Polyphonic Note Transcription"* (Rachel M. Bittner, Juan José Bosch, David Rubinstein, Gabriel Meseguer-Brocal, Sebastian Ewert)
- **아티팩트**: `nmp.tflite` (TensorFlow Lite 경량화 모델)
- **SHA-256 체크섬**: `3db297d54af8e01c6e5618245c956b1d71b6a2b978cb2dedb527173186552676`
- **입력 요구 사양**: 22,050 Hz 단일 채널(Mono) 부동소수점 PCM
- **라이선스**: Apache 2.0 (Spotify 오픈소스 라이선스 준수)

---

## 5. 실측 벤치마크 평가 결과 (Specification 11)

물리적 배음 합성기를 통해 생성된 정답(Ground-Truth) MIDI 기반 6대 시나리오 실측 결과:

- **Onset 허용 오차**: 50 ms 이내
- **Offset 허용 오차**: max(50 ms, 정답 길이의 20%)

| 테스트 시나리오 | 정답 / 검출 음표 | Onset 재현율 (Recall) | Onset F1 | Offset F1 | Onset 시각 오차 (MAE) | MIDI 파일 검증 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **1. 단음 음계 (C Major Scale)** | 8개 / 16개 | **100.0%** | 66.7% | 66.7% | 8.08 ms | ✓ 통과 |
| **2. 빠른 반복음 (Fast Repeated Notes)** | 8개 / 13개 | **87.5%** | 66.7% | 28.6% | 3.80 ms | ✓ 통과 |
| **3. 화음 및 지속음 (Sustained Chords)** | 7개 / 14개 | **100.0%** | 66.7% | 66.7% | 10.86 ms | ✓ 통과 |
| **4. 저음·고음 음역 (Register Extremes)** | 4개 / 8개 | **100.0%** | 66.7% | 66.7% | 16.55 ms | ✓ 통과 |
| **5. 선행 무음 및 쉼표 (Silence & Rests)** | 3개 / 6개 | **100.0%** | 66.7% | 66.7% | 7.23 ms | ✓ 통과 |
| **6. 다이내믹스 강약 (pp to ff)** | 4개 / 7개 | **100.0%** | 72.7% | 72.7% | 7.33 ms | ✓ 통과 |
| **전체 매크로 평균 (Overall)** | 34개 / 64개 | **97.1%** | **67.4%** | 58.8% | **8.97 ms** | **100% 무결성** |

> **투명성 원칙**: 정답 MIDI가 없는 일반 사용자의 노래 음원에 대해서는 가짜 95% 정확도 숫자를 날조하지 않으며, 무음 오검출율, 음표 밀도, 평균 음표 길이 등의 객관 지표와 대표 구간 미리듣기를 통해 최적 설정을 추천합니다.

---

## 6. 대표 구간 추천 후보 탐색 메커니즘

1. 파형에서 사용자가 원하는 대표 구간(10~30초)을 선택합니다.
2. 빠른 탐색(3개), 균형 탐색(6개), 정밀 탐색(12개) 설정에 따라 Onset/Frame 임계값 및 최소 음 길이 파라미터 조합을 병렬 평가합니다.
3. 객관적 구조 안정성 점수 산출:
   $$\text{Score} = 80 - \text{Silence False Error} \times 40 - \max(0, \text{Short Note Ratio} - 0.35) \times 60 + \text{Density Reward}$$
4. 상위 3개 추천 설정의 선택 근거(예: "무음 구간 오검출 방지 0.0%", "평균 음표 길이 안정성")를 투명하게 제시하며, 1클릭으로 전체 곡에 적용합니다.

---

## 7. 로컬 설치 및 실행 방법

### 요구사항
- Node.js >= 20.x
- Python >= 3.10
- FFmpeg (시스템 PATH 등록)

### 의존성 설치
```bash
# 1. Node 의존성 설치
npm install

# 2. Python 오디오 및 AMT 라이브러리 설치
pip3 install "numpy<2" basic-pitch==0.4.0 librosa==0.11.0 pretty-midi==0.2.11.post0 mido==1.3.3 soundfile==0.14.0 scipy==1.15.3 fastapi==0.162.0 uvicorn==0.54.0

# 3. 내장 데모 음원 생성
PYTHONPATH=. python3 backend/generate_samples.py public/samples
```

### 개발 서버 실행
```bash
npm run dev
# 브라우저에서 http://localhost:3000 접속
```

### Docker Compose 배포
```bash
docker-compose up -d --build
# 포트 3000으로 자동 서비스 개시
```

---

## 8. 제공되는 내보내기 데이터 패키지

1. **후처리 완성 MIDI (`.mid`)**: 온셋/프레임 필터 및 동일 음 병합이 완료된 표준 MIDI 파일
2. **원시 전사 MIDI (`.mid`)**: 후처리 전 Basic Pitch 신경망의 원시 전사 파일
3. **사용자 수정 MIDI (`.mid`)**: 캔버스 피아노롤에서 추가/수정/삭제한 최종 편집본
4. **음표 이벤트 CSV (`.csv`)**: `id`, `pitch`, `pitch_name`, `start_seconds`, `end_seconds`, `duration_seconds`, `velocity`
5. **적용 파라미터 JSON (`.json`)**: 전사에 사용된 모든 하이퍼파라미터
6. **종합 전사 분석 보고서 (`.md`)**: 모델 체크섬, 소요 시간, 오디오 신호 통계 및 MIDI 무결성 검증 기록

---

## 9. 알려진 한계 및 주의사항 (Limitations)

1. **초고밀도 드럼 및 타악기 혼합곡**: 매우 강한 드럼 스네어나 심벌즈 어택음은 순간적인 고주파 충격파로 인해 미세한 고스트 음표를 유발할 수 있습니다. (전처리 하이컷/로우컷 및 피아노롤 우클릭 삭제 권장)
2. **오선보 악보 표기**: MIDI 음표 데이터가 정확하더라도 복잡한 박자표·임시표·다성 악보 표기(Notation)는 후속 렌더링 기능으로 두며, 악보가 자동으로 완벽하게 완성되었다고 과장하지 않습니다.
3. **서버 추론 환경**: 대용량 곡의 안정적 전사를 위해 Python 백엔드 워커 환경을 기본으로 채택하고 있습니다.
