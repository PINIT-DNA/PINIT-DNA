import { useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { StepHead } from './parts';
import { captureVoiceFingerprint, VoiceCaptureError } from '../../lib/voice-fingerprint';
import { pickRandomVoicePhrase } from '../../lib/voice-phrases';

interface VoiceCaptureStepProps {
  /** When true, pick a random phrase each session (enterprise enrollment). */
  randomPhrase?: boolean;
  /** Fixed phrase override. */
  phrase?: string;
  /** Voice is optional — show Skip. */
  optional?: boolean;
  onDone: (fp: number[]) => void;
  onSkip?: () => void;
  onError?: (msg: string) => void;
}

function titleForError(err: string): string {
  if (/permission/i.test(err)) return 'Microphone permission needed';
  if (/not found|unavailable|in use/i.test(err)) return 'Microphone unavailable';
  if (/does not support|Web Audio/i.test(err)) return 'Microphone not supported';
  if (/stream/i.test(err)) return 'No microphone audio';
  if (/no speech/i.test(err)) return 'No speech detected';
  return 'Could not capture voice';
}

/** Voice capture — tap to record. Optional secondary signal, not the account authenticator. */
export function VoiceCaptureStep({
  randomPhrase = true,
  phrase,
  optional = true,
  onDone,
  onSkip,
  onError,
}: VoiceCaptureStepProps) {
  const [spokenPhrase, setSpokenPhrase] = useState(() => phrase ?? pickRandomVoicePhrase());
  const [progress, setProgress] = useState(0);
  const [level, setLevel] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'error'>('idle');
  const [error, setError] = useState('');
  const onDoneRef = useRef(onDone);
  const onErrorRef = useRef(onError);
  onDoneRef.current = onDone;
  onErrorRef.current = onError;

  async function startRecording() {
    if (randomPhrase && !phrase) setSpokenPhrase(pickRandomVoicePhrase());
    setPhase('recording');
    setProgress(0);
    setLevel(0);
    setError('');
    try {
      const fp = await captureVoiceFingerprint(
        (p) => setProgress(p),
        (l) => setLevel(l),
      );
      onDoneRef.current(fp);
    } catch (e) {
      const msg = e instanceof VoiceCaptureError || e instanceof Error
        ? e.message
        : 'Voice capture failed. Allow microphone access.';
      setError(msg);
      setPhase('error');
      onErrorRef.current?.(msg);
    }
  }

  return (
    <div className="pa-card">
      <StepHead
        icon={<Mic size={26} color="#6366f1" />}
        title="Voice check"
        subtitle={
          phase === 'error'
            ? titleForError(error)
            : phase === 'recording'
              ? progress < 12
                ? 'Get ready…'
                : 'Speak now — read the phrase aloud'
              : 'Optional — tap Record, then speak the phrase'
        }
      />
      <div style={{ margin: '4px 0 18px', padding: '16px', borderRadius: 14, textAlign: 'center', background: 'rgba(99,102,241,0.06)', fontSize: 16, fontWeight: 600, color: '#3730a3', fontStyle: 'italic' }}>
        “{spokenPhrase}”
      </div>
      {phase === 'idle' && (
        <div style={{ textAlign: 'center' }}>
          <button type="button" className="pa-btn" onClick={() => void startRecording()}>
            Record phrase
          </button>
          {optional && onSkip && (
            <button type="button" className="pa-btn pa-btn-ghost" style={{ marginTop: 10 }} onClick={onSkip}>
              Skip voice
            </button>
          )}
        </div>
      )}
      {phase === 'recording' && (
        <>
          <div style={{ height: 6, borderRadius: 99, background: 'rgba(99,102,241,0.12)', overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', width: `${Math.round(progress)}%`, background: '#6366f1', transition: 'width 0.15s' }} />
          </div>
          <div style={{ height: 4, borderRadius: 99, background: 'rgba(16,185,129,0.12)', overflow: 'hidden', marginBottom: 10 }}>
            <div style={{ height: '100%', width: `${Math.round(level * 100)}%`, background: level > 0.35 ? '#10b981' : '#6366f1', transition: 'width 0.08s' }} />
          </div>
          <p className="pa-accent mono" style={{ textAlign: 'center', fontSize: 12.5 }}>
            {progress < 12 ? 'Starting mic…' : `Recording · ${Math.round(progress)}%`}
          </p>
        </>
      )}
      {phase === 'error' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>{error}</p>
          <button type="button" className="pa-btn" onClick={() => void startRecording()}>Try again</button>
          {optional && onSkip && (
            <button type="button" className="pa-btn pa-btn-ghost" style={{ marginTop: 10 }} onClick={onSkip}>
              Skip voice
            </button>
          )}
        </div>
      )}
    </div>
  );
}
