/**
 * Public .pinit opener. No account.
 *
 * Reads the carrier, then navigates to the existing share viewer.
 * Does not call the access API — tracking starts on /s/{token}.
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileUp } from 'lucide-react';
import { readPinitFile, type PinitReadResult } from '../../../src/lib/pinit-file';

type Phase = 'idle' | 'reading' | 'opening' | 'error';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function OpenPinitPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const busy = phase === 'reading' || phase === 'opening';

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = '';
  };

  const openFile = async (file: File) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setMessage(null);
    setPhase('reading');

    await wait(280);
    if (requestRef.current !== requestId) return;

    let result: PinitReadResult;
    try {
      result = await readPinitFile(file);
    } catch {
      result = { ok: false, code: 'invalid_file', message: 'Invalid .pinit file' };
    }
    if (requestRef.current !== requestId) return;

    if (!result.ok) {
      setPhase('error');
      setMessage(result.message);
      resetInput();
      return;
    }

    if (!result.path.startsWith('/s/') || result.path.includes('://')) {
      setPhase('error');
      setMessage('This file cannot be opened');
      resetInput();
      return;
    }

    setPhase('opening');
    await wait(320);
    if (requestRef.current !== requestId) return;
    navigate(result.path, { replace: true });
  };

  const takeFileList = (list: FileList | null) => {
    if (!list || list.length === 0 || busy) return;
    if (list.length > 1) {
      setPhase('error');
      setMessage('This file cannot be opened');
      resetInput();
      return;
    }
    const file = list[0];
    if (!file) return;
    void openFile(file);
  };

  return (
    <div className="min-h-[100dvh] bg-bg-base flex items-center justify-center px-4 py-8">
      <div
        className={`w-full max-w-md rounded-2xl border bg-bg-card px-6 py-10 sm:px-8 text-center shadow-2xl transition-colors ${
          dragOver ? 'border-dna-400 bg-dna-500/5' : 'border-bg-border'
        }`}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          takeFileList(event.dataTransfer.files);
        }}
      >
        <p className="text-xs font-semibold tracking-[0.28em] text-dna-400">PINIT</p>
        <h1 className="mt-4 text-xl sm:text-2xl font-bold text-white">Open your .pinit file</h1>
        <p className="mt-2 text-sm text-gray-400">
          No account needed. The file only points at an existing protected share.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".pinit"
          className="sr-only"
          aria-label="Choose .pinit file"
          disabled={busy}
          onChange={(event) => takeFileList(event.target.files)}
        />

        {phase === 'reading' && (
          <p className="mt-8 text-sm text-white" role="status">Reading PINIT file...</p>
        )}
        {phase === 'opening' && (
          <p className="mt-8 text-sm text-white" role="status">Opening secure viewer...</p>
        )}

        {!busy && (
          <button
            type="button"
            className="btn btn-primary mt-8 w-full min-h-[44px]"
            onClick={() => inputRef.current?.click()}
          >
            <FileUp size={16} />
            Choose .pinit file
          </button>
        )}

        <p className="mt-4 text-xs text-gray-500 hidden sm:block">or drag and drop it here</p>

        {message && (
          <p className="mt-4 text-sm text-red-400" role="alert">{message}</p>
        )}
      </div>
    </div>
  );
}
