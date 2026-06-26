import { useState, useRef, useEffect, useCallback } from 'react';
import * as faceapi from 'face-api.js';
import { RefreshCw, CheckCircle, AlertTriangle, UserPlus, LogIn } from 'lucide-react';
import { API_BASE_URL } from '../../config/api.config';

interface FaceAuthProps {
  mode: 'login' | 'register';
  onSuccess: (data: Record<string, unknown>) => void;
  onSwitchMode: () => void;
}

type LivenessStep = 'init' | 'detecting' | 'blink' | 'smile' | 'capture' | 'processing' | 'done' | 'error';

const LIVENESS_MESSAGES: Record<LivenessStep, string> = {
  init: 'Initializing camera...',
  detecting: 'Position your face in the frame',
  blink: 'Blink your eyes slowly',
  smile: 'Now smile naturally',
  capture: 'Hold still — capturing face',
  processing: 'Processing face data...',
  done: '',
  error: '',
};

function normalizeEmbedding(values: Float32Array): number[] {
  const out = new Float32Array(128);
  let norm = 0;
  for (let i = 0; i < 128; i++) {
    norm += values[i]! * values[i]!;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < 128; i++) out[i] = values[i]! / norm;
  return Array.from(out);
}

function distPoints(a: faceapi.Point, b: faceapi.Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeAspectRatio(eye: faceapi.Point[]): number {
  const v1 = distPoints(eye[1]!, eye[5]!);
  const v2 = distPoints(eye[2]!, eye[4]!);
  const h = distPoints(eye[0]!, eye[3]!);
  return (v1 + v2) / (2 * h);
}

async function postFaceApi(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const url = `${API_BASE_URL}${path}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (res.status >= 500 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      lastErr = e;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastErr ?? new Error('Face API unreachable');
}

export function FaceAuth({ mode, onSuccess, onSwitchMode }: FaceAuthProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [step, setStep] = useState<LivenessStep>('init');
  const stepRef = useRef<LivenessStep>('init');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const detectionRef = useRef<number | null>(null);
  const blinkCountRef = useRef(0);
  const wasEyesClosedRef = useRef(false);
  const embeddingsRef = useRef<Float32Array[]>([]);

  const updateStep = (next: LivenessStep) => {
    stepRef.current = next;
    setStep(next);
  };

  useEffect(() => {
    async function loadModels() {
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
          faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
          faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
          faceapi.nets.faceExpressionNet.loadFromUri('/models'),
        ]);
        setModelsLoaded(true);
      } catch {
        setError('Failed to load face detection models. Refresh the page.');
        updateStep('error');
      }
    }
    loadModels();
    return () => {
      if (detectionRef.current) cancelAnimationFrame(detectionRef.current);
    };
  }, []);

  const stopCamera = useCallback(() => {
    if (detectionRef.current) cancelAnimationFrame(detectionRef.current);
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
    }
  }, []);

  const processEmbeddings = useCallback(async () => {
    try {
      const avg = new Float32Array(128);
      for (const emb of embeddingsRef.current) {
        for (let i = 0; i < 128; i++) avg[i] += emb[i]! / embeddingsRef.current.length;
      }
      const embedding = normalizeEmbedding(avg);

      const path = mode === 'register' ? '/auth/face/register' : '/auth/face/login';
      const { status, data } = await postFaceApi(path, { embedding });

      if (data.success === true && data.matched !== false) {
        updateStep('done');
        setProgress(100);
        stopCamera();
        onSuccess(data);
        return;
      }

      updateStep('error');
      setError(
        (typeof data.message === 'string' && data.message) ||
        (status === 409 ? 'This face is already registered. Please login.' : null) ||
        (mode === 'login' ? 'Face not recognized. Register first or try again.' : 'Registration failed. Please try again.'),
      );
    } catch {
      updateStep('error');
      setError(`Cannot reach server. Check connection to ${API_BASE_URL.replace('/api/v1', '')}`);
    }
  }, [mode, onSuccess, stopCamera]);

  const runDetection = useCallback(() => {
    const detect = async () => {
      if (!videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const currentStep = stepRef.current;

      if (video.readyState < 2) {
        detectionRef.current = requestAnimationFrame(detect);
        return;
      }

      const detection = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 }))
        .withFaceLandmarks()
        .withFaceExpressions()
        .withFaceDescriptor();

      const ctx = canvas.getContext('2d');
      if (ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }

      if (detection) {
        if (ctx) {
          const box = detection.detection.box;
          ctx.strokeStyle = '#818cf8';
          ctx.lineWidth = 3;
          ctx.strokeRect(box.x, box.y, box.width, box.height);
        }

        const expressions = detection.expressions;
        const landmarks = detection.landmarks;
        const leftEar = eyeAspectRatio(landmarks.getLeftEye());
        const rightEar = eyeAspectRatio(landmarks.getRightEye());
        const eyesClosed = leftEar < 0.22 && rightEar < 0.22;

        if (currentStep === 'detecting') {
          updateStep('blink');
          setProgress(25);
        }

        if (currentStep === 'blink') {
          if (eyesClosed) wasEyesClosedRef.current = true;
          if (wasEyesClosedRef.current && !eyesClosed) {
            blinkCountRef.current++;
            wasEyesClosedRef.current = false;
          }
          if (blinkCountRef.current >= 1) {
            updateStep('smile');
            setProgress(50);
          }
        }

        if (currentStep === 'smile') {
          if (expressions.happy > 0.45 || expressions.surprised > 0.35) {
            updateStep('capture');
            setProgress(75);
          }
        }

        if (currentStep === 'capture') {
          embeddingsRef.current.push(detection.descriptor);
          if (embeddingsRef.current.length >= 3) {
            updateStep('processing');
            setProgress(90);
            await processEmbeddings();
            return;
          }
        }
      }

      detectionRef.current = requestAnimationFrame(detect);
    };
    detect();
  }, [processEmbeddings]);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        updateStep('detecting');
        runDetection();
      }
    } catch {
      setError('Camera access denied. Please allow camera permission.');
      updateStep('error');
    }
  }, [runDetection]);

  useEffect(() => {
    if (!modelsLoaded) return;
    startCamera();
    return () => stopCamera();
  }, [modelsLoaded, startCamera, stopCamera]);

  const retry = () => {
    updateStep('detecting');
    setError(null);
    blinkCountRef.current = 0;
    wasEyesClosedRef.current = false;
    embeddingsRef.current = [];
    setProgress(0);
    runDetection();
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3] mb-4">
        <video
          ref={videoRef}
          className="w-full h-full object-cover mirror"
          autoPlay playsInline muted
          style={{ transform: 'scaleX(-1)' }}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ transform: 'scaleX(-1)' }}
        />

        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-60 border-2 border-dna-400/40 rounded-[40%]">
            <div className="absolute -top-1 -left-1 w-6 h-6 border-t-2 border-l-2 border-dna-400 rounded-tl-xl" />
            <div className="absolute -top-1 -right-1 w-6 h-6 border-t-2 border-r-2 border-dna-400 rounded-tr-xl" />
            <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-2 border-l-2 border-dna-400 rounded-bl-xl" />
            <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-2 border-r-2 border-dna-400 rounded-br-xl" />
          </div>
        </div>

        <div className="absolute bottom-3 left-0 right-0 flex justify-center">
          <div className={`px-4 py-1.5 rounded-full text-xs font-bold backdrop-blur-md ${
            step === 'done' ? 'bg-green-500/80 text-white' :
            step === 'error' ? 'bg-red-500/80 text-white' :
            'bg-black/60 text-dna-400'
          }`}>
            {step === 'done' ? 'Verified' :
             step === 'error' ? error :
             LIVENESS_MESSAGES[step]}
          </div>
        </div>
      </div>

      <div className="h-1.5 bg-bg-elevated rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-gradient-to-r from-dna-500 to-accent-light rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex justify-between mb-6 px-2">
        {[
          { label: 'Detect', done: progress >= 25 },
          { label: 'Blink', done: progress >= 50 },
          { label: 'Smile', done: progress >= 75 },
          { label: 'Verify', done: progress >= 100 },
        ].map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
              s.done ? 'bg-success text-white' : 'bg-bg-elevated text-gray-500 border border-bg-border'
            }`}>
              {s.done ? '✓' : i + 1}
            </div>
            <span className={`text-[10px] font-semibold ${s.done ? 'text-success' : 'text-gray-500'}`}>{s.label}</span>
          </div>
        ))}
      </div>

      {step === 'error' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
            <AlertTriangle size={20} className="text-red-400" />
            <p className="text-sm text-red-400 font-semibold">{error}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={retry} className="btn btn-primary flex-1">
              <RefreshCw size={14} /> Try Again
            </button>
            <button onClick={onSwitchMode} className="btn btn-secondary flex-1">
              {mode === 'login' ? <><UserPlus size={14} /> Register</> : <><LogIn size={14} /> Login</>}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
          <CheckCircle size={20} className="text-green-400" />
          <p className="text-sm text-green-400 font-semibold">
            {mode === 'register' ? 'Face registered! Redirecting...' : 'Identity verified! Logging in...'}
          </p>
        </div>
      )}

      {step !== 'done' && step !== 'error' && (
        <button onClick={onSwitchMode} className="w-full text-center text-xs text-gray-500 hover:text-dna-400 transition mt-2">
          {mode === 'login' ? "Don't have an account? Register with face" : 'Already registered? Login with face'}
        </button>
      )}
    </div>
  );
}
