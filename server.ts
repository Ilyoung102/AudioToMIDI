import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn, ChildProcess } from 'child_process';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const WORKSPACE_DIR = '/tmp/audio2midi_workspace';
fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

const upload = multer({
  dest: path.join(WORKSPACE_DIR, 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max limit
});

interface Job {
  id: string;
  status: 'queued' | 'analyzing' | 'preprocessing' | 'inferring' | 'postprocessing' | 'verifying' | 'completed' | 'error' | 'cancelled';
  stepMessage: string;
  progress: number;
  audioPath: string;
  audioName: string;
  params: any;
  startTime: number;
  endTime?: number;
  result?: any;
  error?: string;
  process?: ChildProcess;
}

const jobs = new Map<string, Job>();

// Run python CLI helper
function runPythonCommand(args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const python = spawn('python3', args, {
      env: { ...process.env, PYTHONPATH: '.' },
      cwd: __dirname,
    });

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Python process exited with code ${code}: ${stderr || stdout}`));
      }
      try {
        // Look for the last valid JSON output line
        const lines = stdout.trim().split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (line.startsWith('{') && line.endsWith('}')) {
            return resolve(JSON.parse(line));
          }
        }
        resolve(JSON.parse(stdout.trim()));
      } catch (err: any) {
        reject(new Error(`Failed to parse Python JSON output: ${err.message}. Raw output:\n${stdout}`));
      }
    });

    python.on('error', (err) => {
      reject(err);
    });
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Static files for samples
  app.use('/samples', express.static(path.join(__dirname, 'public/samples')));

  // Health check
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      engine: 'Spotify Basic Pitch ICASSP 2022',
      model_sha256: '3db297d54af8e01c6e5618245c956b1d71b6a2b978cb2dedb527173186552676',
      architecture: 'Full-stack (React + Express + Python worker)',
      timestamp: new Date().toISOString()
    });
  });

  // Get built-in preset demo tracks
  app.get('/api/samples', async (req: Request, res: Response) => {
    const samples = [
      {
        id: 'sample_piano',
        title: '쇼팽 스타일 피아노 독주 (Piano Solo)',
        filename: 'piano_chopin_style.wav',
        url: '/samples/piano_chopin_style.wav',
        mode: 'piano_solo',
        description: 'C - Am - Dm - G7 풍부한 화음과 양손 연주 타건 분리 테스트',
        duration_sec: 12.0
      },
      {
        id: 'sample_vocal',
        title: '발라드 보컬 주선율 (Lead Vocal)',
        filename: 'vocal_lead_ballad.wav',
        url: '/samples/vocal_lead_ballad.wav',
        mode: 'lead_vocal',
        description: '인간 가창 비브라토 및 감정선 선율 추출 테스트',
        duration_sec: 12.0
      },
      {
        id: 'sample_flute',
        title: '플루트 독주 멜로디 (Single Instrument)',
        filename: 'flute_instrument_solo.wav',
        url: '/samples/flute_instrument_solo.wav',
        mode: 'single_instrument',
        description: '단일 목관/현악기의 명확한 음역대 단음 멜로디 테스트',
        duration_sec: 12.0
      },
      {
        id: 'sample_band',
        title: '복합 밴드 앙상블 (Polyphonic Band Groove)',
        filename: 'polyphonic_band_groove.wav',
        url: '/samples/polyphonic_band_groove.wav',
        mode: 'full_mix',
        description: '베이스, 피아노 화음, 선율이 복합된 다성 음원 테스트',
        duration_sec: 12.0
      }
    ];
    res.json({ samples });
  });

  // Upload and inspect audio
  app.post('/api/upload', upload.single('audio'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No audio file provided' });
      }

      const filePath = req.file.path;
      const inspectData = await runPythonCommand([
        'backend/cli.py',
        'analyze',
        '--audio', filePath
      ]);

      res.json({
        success: true,
        file: {
          path: filePath,
          originalName: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype
        },
        inspection: inspectData
      });
    } catch (err: any) {
      console.error('Upload inspection error:', err);
      res.status(500).json({ error: err.message || 'Inspection failed' });
    }
  });

  // Inspect existing sample or local file
  app.post('/api/inspect', async (req: Request, res: Response) => {
    try {
      const { audioPath } = req.body;
      let targetPath = audioPath;
      if (audioPath.startsWith('/samples/')) {
        targetPath = path.join(__dirname, 'public', audioPath);
      }
      if (!fs.existsSync(targetPath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      const inspectData = await runPythonCommand([
        'backend/cli.py',
        'analyze',
        '--audio', targetPath
      ]);

      res.json({
        success: true,
        inspection: inspectData
      });
    } catch (err: any) {
      console.error('Inspect error:', err);
      res.status(500).json({ error: err.message || 'Inspection failed' });
    }
  });

  // Create transcription job
  app.post('/api/jobs/create', async (req: Request, res: Response) => {
    try {
      let { audioPath, params } = req.body;
      if (!audioPath) {
        return res.status(400).json({ error: 'audioPath is required' });
      }

      if (audioPath.startsWith('/samples/')) {
        audioPath = path.join(__dirname, 'public', audioPath);
      }

      if (!fs.existsSync(audioPath)) {
        return res.status(404).json({ error: 'Audio file not found' });
      }

      const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const jobDir = path.join(WORKSPACE_DIR, jobId);
      fs.mkdirSync(jobDir, { recursive: true });

      const job: Job = {
        id: jobId,
        status: 'queued',
        stepMessage: '작업 큐 대기 중...',
        progress: 5,
        audioPath,
        audioName: path.basename(audioPath),
        params: params || {},
        startTime: Date.now()
      };

      jobs.set(jobId, job);

      // Launch async processing
      processJobAsync(job, jobDir);

      res.json({
        success: true,
        jobId,
        status: job.status
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get job status
  app.get('/api/jobs/:id', (req: Request, res: Response) => {
    const job = jobs.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      id: job.id,
      status: job.status,
      stepMessage: job.stepMessage,
      progress: job.progress,
      elapsed_sec: Math.round((Date.now() - job.startTime) / 100) / 10,
      result: job.result,
      error: job.error
    });
  });

  // Cancel job
  app.post('/api/jobs/:id/cancel', (req: Request, res: Response) => {
    const job = jobs.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.process && !job.process.killed) {
      job.process.kill('SIGTERM');
    }
    job.status = 'cancelled';
    job.stepMessage = '작업이 사용자에 의해 취소되었습니다.';
    res.json({ success: true, status: 'cancelled' });
  });

  // Candidate comparison
  app.post('/api/compare', async (req: Request, res: Response) => {
    try {
      let { audioPath, startSec, endSec, mode } = req.body;
      if (audioPath.startsWith('/samples/')) {
        audioPath = path.join(__dirname, 'public', audioPath);
      }

      const tempDir = path.join(WORKSPACE_DIR, `comp_${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });

      const result = await runPythonCommand([
        'backend/cli.py',
        'compare',
        '--audio', audioPath,
        '--start', String(startSec ?? 0),
        '--end', String(endSec ?? 15),
        '--mode', mode || 'balanced',
        '--out-dir', tempDir
      ]);

      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('Candidate comparison error:', err);
      res.status(500).json({ error: err.message || 'Comparison failed' });
    }
  });

  // AMT Test Suite Benchmark
  app.get('/api/benchmark', async (req: Request, res: Response) => {
    try {
      const tempDir = path.join(WORKSPACE_DIR, `bench_${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });

      const result = await runPythonCommand([
        'backend/cli.py',
        'benchmark',
        '--out-dir', tempDir
      ]);

      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('Benchmark error:', err);
      res.status(500).json({ error: err.message || 'Benchmark execution failed' });
    }
  });

  // Save edited MIDI from piano roll notes
  app.post('/api/save-edited-midi', async (req: Request, res: Response) => {
    try {
      const { notes, bpm, jobId } = req.body;
      if (!Array.isArray(notes)) {
        return res.status(400).json({ error: 'Notes array required' });
      }

      const editDir = path.join(WORKSPACE_DIR, jobId || 'custom_edit');
      fs.mkdirSync(editDir, { recursive: true });
      const editedMidiPath = path.join(editDir, 'transcription_user_edited.mid');

      // Call python to write and verify edited MIDI
      const scriptCode = `
import json
import pretty_midi
from backend.engine import MidiWriterAndVerifier

notes_data = json.loads('${JSON.stringify(notes).replace(/'/g, "\\'")}')
bpm_val = float(${bpm || 120.0})
out_path = '${editedMidiPath}'

res = MidiWriterAndVerifier.create_midi(notes_data, out_path, bpm=bpm_val)
print(json.dumps(res))
`;

      const python = spawn('python3', ['-c', scriptCode], {
        env: { ...process.env, PYTHONPATH: '.' },
        cwd: __dirname
      });

      let stdout = '';
      python.stdout.on('data', d => stdout += d.toString());
      python.on('close', (code) => {
        if (code === 0) {
          res.json({
            success: true,
            filePath: editedMidiPath,
            url: `/api/download?file=${encodeURIComponent(editedMidiPath)}&name=user_edited.mid`
          });
        } else {
          res.status(500).json({ error: 'Failed to write edited MIDI' });
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // File download endpoint
  app.get('/api/download', (req: Request, res: Response) => {
    const filePath = req.query.file as string;
    const downloadName = (req.query.name as string) || path.basename(filePath);

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).send('File not found');
    }

    res.download(filePath, downloadName);
  });

  // Handle async job workflow
  async function processJobAsync(job: Job, jobDir: string) {
    try {
      job.status = 'analyzing';
      job.stepMessage = '1/5 음원 신호 특성 및 음량 분석 중...';
      job.progress = 20;

      // Small delay for smooth UI transition
      await new Promise(r => setTimeout(r, 200));

      job.status = 'preprocessing';
      job.stepMessage = '2/5 노이즈 게이트 및 22,050Hz 리샘플링 전처리 중...';
      job.progress = 40;

      job.status = 'inferring';
      job.stepMessage = '3/5 Spotify Basic Pitch 신경망 다성 모델 추론 중...';
      job.progress = 60;

      const pythonArgs = [
        'backend/cli.py',
        'transcribe',
        '--audio', job.audioPath,
        '--params', JSON.stringify(job.params),
        '--out-dir', jobDir
      ];

      const pythonProcess = spawn('python3', pythonArgs, {
        env: { ...process.env, PYTHONPATH: '.' },
        cwd: __dirname
      });

      job.process = pythonProcess;

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (job.status === 'cancelled') return;

        if (code !== 0) {
          job.status = 'error';
          job.error = stderr || stdout || 'Conversion failed with exit code ' + code;
          job.stepMessage = '변환 중 오류가 발생했습니다.';
          return;
        }

        try {
          const lines = stdout.trim().split('\n');
          let jsonResult: any = null;
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (line.startsWith('{') && line.endsWith('}')) {
              jsonResult = JSON.parse(line);
              break;
            }
          }
          if (!jsonResult) {
            jsonResult = JSON.parse(stdout.trim());
          }

          job.status = 'completed';
          job.stepMessage = 'MIDI 변환 및 시간 정합성 검증 완료!';
          job.progress = 100;
          job.endTime = Date.now();
          job.result = jsonResult;
        } catch (e: any) {
          job.status = 'error';
          job.error = 'Failed to parse conversion result: ' + e.message;
          job.stepMessage = '결과 파싱 오류';
        }
      });
    } catch (err: any) {
      job.status = 'error';
      job.error = err.message;
      job.stepMessage = '변환 오류: ' + err.message;
    }
  }

  // Development: Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production: serve built static assets
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Audio2MIDI Studio Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
