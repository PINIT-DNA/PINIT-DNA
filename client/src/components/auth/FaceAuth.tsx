import { useState, useRef, useEffect, useCallback } from 'react';
import * as faceapi from 'face-api.js';
import { RefreshCw, CheckCircle, AlertTriangle, UserPlus, LogIn } from 'lucide-react';

interface FaceAuthProps {
  mode: 'login' | 'register';
  onSuccess: (data: any) => void;
  onSwitchMode: () => void;
}

type LivenessStep = 'init' | 'detecting' | 'blink' | 'smile' | 'capture' | 'processing' | 'done' | 'error';

const LIVENESS_MESSAGES: Record<LivenessStep, string> = {
  init: 'Initializing camera...',
  detecting: 'Position your face in the frame',
  blink: 'Blink your eyes',
  smile: 'Now smile',
  capture: 'Hold still — capturing face',
  processing: 'Processing face data...',
  done: '',
  error: '',
};

export function FaceAuth({ mode, onSuccess, onSwitchMode }: FaceAuthProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [step, setStep] = useState<LivenessStep>('init');
  const [error, setError] = useState<string | null>(null);
  const [, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const detectionRef = useRef<number | null>(null);
  const blinkCountRef = useRef(0);
  const smileDetectedRef = useRef(false);
  const embeddingsRef = useRef<Float32Array[]>([]);

  // Load face-api models
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
      } catch (e) {
        setError('Failed to load face detection models');
      }
    }
    loadModels();
    return () => { if (detectionRef.current) cancelAnimationFrame(detectionRef.current); };
  }, []);

  // Start camera when models loaded
  useEffect(() => {
    if (!modelsLoaded) return;
    startCamera();
    return () => stopCamera();
  }, [modelsLoaded]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
        setStep('detecting');
        runDetection();
      }
    } catch {
      setError('Camera access denied. Please allow camera permission.');
    }
  };

  const stopCamera = () => {
    if (detectionRef.current) cancelAnimationFrame(detectionRef.current);
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    }
  };

  const runDetection = useCallback(() => {
    const detect = async () => {
      if (!videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;

      const detection = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5 }))
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
        // Draw face outline
        if (ctx) {
          const box = detection.detection.box;
          ctx.strokeStyle = '#818cf8';
          ctx.lineWidth = 3;
          ctx.strokeRect(box.x, box.y, box.width, box.height);
        }

        const expressions = detection.expressions;

        // Liveness: blink detection (eyes closed = neutral high + no smile)
        if (step === 'detecting') {
          setStep('blink');
          setProgress(25);
        }

        if (step === 'blink') {
          const eyesClosed = expressions.neutral > 0.7 && expressions.happy < 0.1;
          if (eyesClosed) {
            blinkCountRef.current++;
          }
          if (blinkCountRef.current >= 2) {
            setStep('smile');
            setProgress(50);
          }
        }

        if (step === 'smile') {
          if (expressions.happy > 0.7) {
            smileDetectedRef.current = true;
            setStep('capture');
            setProgress(75);
          }
        }

        if (step === 'capture') {
          embeddingsRef.current.push(detection.descriptor);
          if (embeddingsRef.current.length >= 3) {
            setStep('processing');
            setProgress(90);
            processEmbeddings();
            return;
          }
        }
      }

      detectionRef.current = requestAnimationFrame(detect);
    };
    detect();
  }, [step]);

  // Re-run detection when step changes
  useEffect(() => {
    if (cameraReady && step !== 'processing' && step !== 'done' && step !== 'error' && step !== 'init') {
      if (detectionRef.current) cancelAnimationFrame(detectionRef.current);
      runDetection();
    }
  }, [step, cameraReady, runDetection]);

  const processEmbeddings = async () => {
    setLoading(true);
    try {
      // Average the 3 captured embeddings for robustness
      const avg = new Float32Array(128);
      for (const emb of embeddingsRef.current) {
        for (let i = 0; i < 128; i++) avg[i] += emb[i]! / embeddingsRef.current.length;
      }

      const endpoint = mode === 'register' ? '/api/v1/auth/face/register' : '/api/v1/auth/face/login';

      const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL?.replace('/api/v1', '') || '';
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedding: Array.from(avg) }),
      });

      const data = await res.json();

      if (data.success && (data.matched !== false)) {
        setStep('done');
        setProgress(100);
        stopCamera();
        onSuccess(data);
      } else {
        setStep('error');
        setError(data.message || 'Face not recognized');
      }
    } catch {
      setStep('error');
      setError('Network error. Please try again.');
    }
    setLoading(false);
  };

  const retry = () => {
    setStep('detecting');
    setError(null);
    blinkCountRef.current = 0;
    smileDetectedRef.current = false;
    embeddingsRef.current = [];
    setProgress(0);
    runDetection();
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Camera viewfinder */}
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

        {/* Face frame overlay */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-60 border-2 border-dna-400/40 rounded-[40%]">
            <div className="absolute -top-1 -left-1 w-6 h-6 border-t-2 border-l-2 border-dna-400 rounded-tl-xl" />
            <div className="absolute -top-1 -right-1 w-6 h-6 border-t-2 border-r-2 border-dna-400 rounded-tr-xl" />
            <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-2 border-l-2 border-dna-400 rounded-bl-xl" />
            <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-2 border-r-2 border-dna-400 rounded-br-xl" />
          </div>
        </div>

        {/* Status badge */}
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

      {/* Progress bar */}
      <div className="h-1.5 bg-bg-elevated rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-gradient-to-r from-dna-500 to-accent-light rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Liveness steps indicator */}
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

      {/* Error state */}
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

      {/* Success state */}
      {step === 'done' && (
        <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
          <CheckCircle size={20} className="text-green-400" />
          <p className="text-sm text-green-400 font-semibold">
            {mode === 'register' ? 'Face registered! Redirecting...' : 'Identity verified! Logging in...'}
          </p>
        </div>
      )}

      {/* Switch mode */}
      {step !== 'done' && step !== 'error' && (
        <button onClick={onSwitchMode} className="w-full text-center text-xs text-gray-500 hover:text-dna-400 transition mt-2">
          {mode === 'login' ? "Don't have an account? Register with face" : 'Already registered? Login with face'}
        </button>
      )}
    </div>
  );
}
