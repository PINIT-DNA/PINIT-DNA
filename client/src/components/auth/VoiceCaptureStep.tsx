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

/** Voice capture — random enterprise phrase, real mic fingerprint. */
export function VoiceCaptureStep({ randomPhrase = true, phrase, onDone, onError }: VoiceCaptureStepProps) {
  const [spokenPhrase, setSpokenPhrase] = useState(() => phrase ?? pickRandomVoicePhrase());
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'recording' | 'error'>('recording');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const onDoneRef = useRef(onDone);
  const onErrorRef = useRef(onError);
  onDoneRef.current = onDone;
  onErrorRef.current = onError;

  useEffect(() => {
    if (randomPhrase && !phrase) setSpokenPhrase(pickRandomVoicePhrase());
  }, [attempt, randomPhrase, phrase]);

  useEffect(() => {
    let cancelled = false;
    setPhase('recording');
    setProgress(0);
    setError('');

    captureVoiceFingerprint((p) => { if (!cancelled) setProgress(p); })
      .then((fp) => { if (!cancelled) onDoneRef.current(fp); })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : 'Voice capture failed. Allow microphone access.';
        setError(msg);
        setPhase('error');
        onErrorRef.current?.(msg);
      });

    return () => { cancelled = true; };
  }, [attempt, spokenPhrase]);

  return (
    <div className="pa-card">
      <StepHead
        icon={<Mic size={26} color="#6366f1" />}
        title="Voice Verification"
        subtitle={phase === 'error' ? 'Could not capture voice' : 'Read the phrase aloud clearly…'}
      />
      <div style={{ margin: '4px 0 18px', padding: '16px', borderRadius: 14, textAlign: 'center', background: 'rgba(99,102,241,0.06)', fontSize: 16, fontWeight: 600, color: '#3730a3', fontStyle: 'italic' }}>
        “{spokenPhrase}”
      </div>
      {phase === 'recording' && (
        <>
          <div style={{ height: 6, borderRadius: 99, background: 'rgba(99,102,241,0.12)', overflow: 'hidden', marginBottom: 10 }}>
            <div style={{ height: '100%', width: `${Math.round(progress)}%`, background: '#6366f1', transition: 'width 0.15s' }} />
          </div>
          <p className="pa-accent mono" style={{ textAlign: 'center', fontSize: 12.5 }}>Recording · {Math.round(progress)}%</p>
        </>
      )}
      {phase === 'error' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>{error}</p>
          <button type="button" className="pa-btn" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
        </div>
      )}
    </div>
  );
}
