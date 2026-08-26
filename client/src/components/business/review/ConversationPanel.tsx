/**
 * The campaign conversation, rendered for whichever side is looking.
 *
 * One component for both audiences, differing only in the props it is given —
 * the same reason ReviewThreads is shared. A message must not read one way to
 * the team and another to the client.
 *
 * The live tick comes from an SSE stream that carries no payload, only "something
 * changed". The list is then refetched through the normal authorised endpoint,
 * so the stream can never become a second way to read data.
 */
import { useEffect, useRef, useState } from 'react';
import { Send, Loader2, AlertTriangle, RefreshCw, MessageSquare, Check, Wifi, WifiOff } from 'lucide-react';

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export interface ConversationMessage {
  id: string;
  body: string;
  authorLabel: string;
  isSystem: boolean;
  createdAt: string;
  readByOther: boolean;
  /** Team view uses isClient; client view uses isMine. Normalised by the caller. */
  mine: boolean;
}

export function ConversationPanel({
  messages, loading, error, onRetry, onSend, onVisible,
  streamUrl, live, audience, senderName, onSenderNameChange, disabled, disabledReason,
}: {
  messages: ConversationMessage[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSend: (body: string) => Promise<void>;
  /** Called when the thread is on screen, to clear unread. */
  onVisible?: () => void;
  /** SSE endpoint that ticks when this campaign changes. */
  streamUrl?: string;
  /** Refetch callback fired on each tick. */
  live?: () => void;
  audience: 'team' | 'client';
  senderName?: string;
  onSenderNameChange?: (v: string) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  // Live tick. Reconnection is left to EventSource, which already retries.
  useEffect(() => {
    if (!streamUrl) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(streamUrl, { withCredentials: true });
      es.onopen = () => setConnected(true);
      es.onmessage = () => liveRef.current?.();
      es.onerror = () => setConnected(false);
    } catch {
      setConnected(false);
    }
    return () => { es?.close(); setConnected(false); };
  }, [streamUrl]);

  useEffect(() => { onVisible?.(); }, [onVisible]);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const submit = async () => {
    const text = body.trim();
    if (!text || busy || disabled) return;
    setBusy(true);
    setSendError(null);
    try {
      await onSend(text);
      setBody('');   // only on success — a failed send never loses typing
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data?.message
        ?? (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? (err instanceof Error ? err.message : 'Could not send — try again');
      setSendError(msg);
    } finally {
      setBusy(false);
    }
  };

  const light = audience === 'client';

  if (loading) return <ConversationSkeleton light={light} />;

  if (error) {
    return (
      <div className={cn('rounded-lg border px-4 py-5 text-center',
        light ? 'border-red-200 bg-red-50' : 'border-danger/30 bg-danger/5')}>
        <AlertTriangle size={18} className={cn('mx-auto mb-2', light ? 'text-red-600' : 'text-danger')} />
        <p className={cn('text-sm font-semibold mb-1', light ? 'text-gray-900' : 'text-white')}>
          Couldn't load messages
        </p>
        <p className={cn('text-xs mb-3', light ? 'text-gray-600' : 'text-gray-400')}>{error}</p>
        <button type="button" onClick={onRetry}
          className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold border',
            light ? 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  : 'border-bg-border bg-bg-elevated text-gray-300 hover:text-white')}>
          <RefreshCw size={13} /> Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ minHeight: 0 }}>
      {streamUrl && (
        <p className={cn('text-2xs flex items-center gap-1.5 mb-2',
          light ? 'text-gray-500' : 'text-gray-500')}>
          {connected
            ? <><Wifi size={10} className="text-emerald-500" /> Live — new messages appear automatically</>
            : <><WifiOff size={10} /> Reconnecting…</>}
        </p>
      )}

      <div className={cn('flex-1 overflow-y-auto space-y-2.5 pr-1', 'max-h-[420px]')}>
        {messages.length === 0 ? (
          <div className={cn('rounded-lg border border-dashed px-4 py-8 text-center',
            light ? 'border-gray-300 bg-gray-50' : 'border-bg-border bg-bg-elevated/40')}>
            <MessageSquare size={20} className="text-gray-400 mx-auto mb-2" />
            <p className={cn('text-sm font-semibold mb-0.5', light ? 'text-gray-900' : 'text-white')}>
              No messages yet
            </p>
            <p className={cn('text-xs', light ? 'text-gray-600' : 'text-gray-400')}>
              {audience === 'client'
                ? 'Start a conversation with the team about this campaign.'
                : 'Start a conversation with your client.'}
            </p>
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} light={light} />)
        )}
        <div ref={endRef} />
      </div>

      {disabled ? (
        <p className={cn('text-xs text-center mt-3', light ? 'text-gray-500' : 'text-gray-500')}>
          {disabledReason ?? 'You cannot send messages here.'}
        </p>
      ) : (
        <div className={cn('mt-3 rounded-xl border p-2.5 space-y-2',
          light ? 'border-gray-200 bg-white' : 'border-bg-border bg-bg-card')}>
          {audience === 'client' && onSenderNameChange && (
            <input
              value={senderName ?? ''}
              onChange={(e) => onSenderNameChange(e.target.value)}
              maxLength={120}
              placeholder="Your name"
              aria-label="Your name"
              className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900
                         placeholder:text-gray-400 focus:outline-none focus:border-blue-500"
            />
          )}

          <label htmlFor="conversation-input" className="sr-only">Write a message</label>
          <textarea
            id="conversation-input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void submit(); }
            }}
            rows={2}
            maxLength={4000}
            placeholder="Write a message…"
            className={cn('w-full rounded-lg px-3 py-2 text-sm resize-y min-h-[56px] focus:outline-none',
              light
                ? 'border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-blue-500'
                : 'bg-bg-elevated border border-bg-border text-white placeholder:text-gray-500 focus:border-dna-500/60')}
          />

          {sendError && (
            <p role="alert" className={cn('text-2xs flex items-start gap-1.5',
              light ? 'text-red-700' : 'text-danger')}>
              <AlertTriangle size={11} className="shrink-0 mt-px" /> {sendError}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!body.trim() || busy}
              className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50',
                light ? 'bg-blue-600 hover:bg-blue-700' : 'bg-dna-500 hover:bg-dna-600')}
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Bubble({ message: m, light }: { message: ConversationMessage; light: boolean }) {
  if (m.isSystem) {
    return (
      <p className={cn('text-2xs text-center py-1.5 px-3 rounded-lg',
        light ? 'text-gray-500 bg-gray-50' : 'text-gray-500 bg-bg-elevated/50')}>
        {m.body}
      </p>
    );
  }

  return (
    <div className={cn('flex', m.mine ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[85%] rounded-xl px-3 py-2',
        m.mine
          ? light ? 'bg-blue-600 text-white' : 'bg-dna-500 text-white'
          : light ? 'bg-gray-100 text-gray-900' : 'bg-bg-elevated text-gray-200')}>
        {!m.mine && (
          <p className={cn('text-2xs font-semibold mb-0.5',
            light ? 'text-gray-600' : 'text-gray-400')}>{m.authorLabel}</p>
        )}
        <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
        <p className={cn('text-2xs mt-1 flex items-center gap-1 justify-end',
          m.mine ? 'text-white/70' : light ? 'text-gray-500' : 'text-gray-500')}>
          {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {m.mine && m.readByOther && <Check size={10} aria-label="Seen" />}
        </p>
      </div>
    </div>
  );
}

function ConversationSkeleton({ light }: { light: boolean }) {
  const bar = light ? 'bg-gray-200' : 'bg-bg-elevated';
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading messages">
      {[0, 1, 2].map((i) => (
        <div key={i} className={cn('flex', i % 2 ? 'justify-end' : 'justify-start')}>
          <div className={cn('h-12 rounded-xl animate-pulse', bar, i % 2 ? 'w-1/2' : 'w-2/3')} />
        </div>
      ))}
    </div>
  );
}
