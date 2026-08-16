import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { StepHead } from './parts';
import { captureVoiceFingerprint } from '../../lib/voice-fingerprint';
import { pickRandomVoicePhrase } from '../../lib/voice-phrases';

interface VoiceCaptureStepProps {
  /** When true, pick a random phrase each session (enterprise enrollment). */
  randomPhrase?: boolean;
  /** Fixed phrase override. */
  phrase?: string;
  onDone: (fp: number[]) => void;
  onError?: (msg: string) => void;
}

type Phase = 'ready' | 'countdown' | 'recording' | 'error';

/** Voice capture — user starts when ready; longer window + clearer mic guidance. */
export function VoiceCaptureStep({ randomPhrase = true, phrase, onDone, onError }: VoiceCaptureStepProps) {
  const [spokenPhrase, setSpokenPhrase] = useState(() => phrase ?? pickRandomVoicePhrase());
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [countdown, setCountdown] = useState(3);
  const [error, setError] = useState('');
  const [session, setSession] = useState(0);
  const onDoneRef = useRef(onDone);
  const onErrorRef = useRef(onError);
  onDoneRef.current = onDone;
  onErrorRef.current = onError;

  useEffect(() => {
    if (randomPhrase && !phrase) setSpokenPhrase(pickRandomVoicePhrase());
  }, [session, randomPhrase, phrase]);

  // Countdown 3-2-1, then record
  useEffect(() => {
    if (phase !== 'countdown') return;
    let n = 3;
    setCountdown(3);
    const id = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        window.clearInterval(id);
        setPhase('recording');
        return;
      }
      setCountdown(n);
    }, 700);
    return () => window.clearInterval(id);
  }, [phase, session]);

  // Actual mic capture only while recording
  useEffect(() => {
    if (phase !== 'recording') return;
    let cancelled = false;
    setProgress(0);
    setError('');

    captureVoiceFingerprint((p) => {
      if (!cancelled) setProgress(p);
    })
      .then((fp) => {
        if (!cancelled) onDoneRef.current(fp);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : 'Voice capture failed. Allow microphone access.';
        setError(msg);
        setPhase('error');
        onErrorRef.current?.(msg);
      });

    return () => {
      cancelled = true;
    };
  }, [phase, session]);

  function startCapture() {
    setError('');
    setProgress(0);
    setSession((s) => s + 1);
    setPhase('countdown');
  }

  return (
    <div className="pa-card">
      <StepHead
        icon={<Mic size={26} color="#6366f1" />}
        title="Voice Verification"
        subtitle={
          phase === 'error'
            ? 'Could not capture voice'
            : phase === 'ready'
              ? 'When ready, press Start and speak the phrase'
              : phase === 'countdown'
                ? 'Get ready to speak…'
                : 'Speak the phrase now — clearly into the mic'
        }
      />
      <div
        style={{
          margin: '4px 0 18px',
          padding: '16px',
          borderRadius: 14,
          textAlign: 'center',
          background: 'rgba(99,102,241,0.06)',
          fontSize: 16,
          fontWeight: 600,
          color: '#3730a3',
          fontStyle: 'italic',
        }}
      >
        “{spokenPhrase}”
      </div>

      {phase === 'ready' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 14, lineHeight: 1.45 }}>
            Allow microphone access when the browser asks. Speak loudly for about 4–5 seconds after the countdown.
          </p>
          <button type="button" className="pa-btn" onClick={startCapture}>
            Start speaking
          </button>
        </div>
      )}

      {phase === 'countdown' && (
        <p className="pa-accent mono" style={{ textAlign: 'center', fontSize: 28, fontWeight: 700 }}>
          {countdown}
        </p>
      )}

      {phase === 'recording' && (
        <>
          <div
            style={{
              height: 6,
              borderRadius: 99,
              background: 'rgba(99,102,241,0.12)',
              overflow: 'hidden',
              marginBottom: 10,
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.round(progress)}%`,
                background: '#6366f1',
                transition: 'width 0.15s',
              }}
            />
          </div>
          <p className="pa-accent mono" style={{ textAlign: 'center', fontSize: 12.5 }}>
            Recording · {Math.round(progress)}% — keep speaking
          </p>
        </>
      )}

      {phase === 'error' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#fca5a5', fontSize: 13, marginBottom: 8 }}>{error}</p>
          <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14, lineHeight: 1.45 }}>
            Check the browser mic permission (lock icon in the address bar), unmute Windows mic, and speak closer to the microphone.
          </p>
          <button type="button" className="pa-btn" onClick={startCapture}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
