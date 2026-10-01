import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowUp, Clock, Download, HelpCircle,
  Link2, Mic, Sparkles, Square, Volume2, VolumeX, X,
  type LucideIcon,
} from 'lucide-react';
import { formatApiError } from '../../services/dashboard.api';
import {
  askPinit,
  getAskPinitInsights,
  type AskPinitInsights,
  type AskPinitReply,
} from '../../services/ask-pinit.api';

type Tab = 'ask' | 'insights' | 'help';

type ChatTurn = {
  id: string;
  question: string;
  reply: AskPinitReply | null;
  error?: string;
};

const ASK_CHAT_KEY = 'pinit_ask_conversation_v1';

function readStoredTurns(): ChatTurn[] {
  try {
    const raw = localStorage.getItem(ASK_CHAT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatTurn[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => t && typeof t.question === 'string' && (t.reply || t.error))
      .slice(-40);
  } catch {
    return [];
  }
}

/** Layout is outside the child route, so params are read from the path. */
function vaultIdFromPath(pathname: string): string | undefined {
  const intel = pathname.match(/\/intelligence\/([0-9a-f-]{20,})/i);
  if (intel?.[1]) return intel[1];
  if (/\/vault\/assets\//i.test(pathname)) return undefined;
  const living = pathname.match(/\/vault\/([0-9a-f-]{20,})/i);
  return living?.[1];
}

function trackingAssetIdFromPath(pathname: string): string | undefined {
  return pathname.match(/\/tracking\/([0-9a-f-]{20,})/i)?.[1];
}

function speechCtor(): (new () => SpeechRecognitionLike) | undefined {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function normalizeReply(data: AskPinitReply): AskPinitReply {
  return {
    success: Boolean(data?.success ?? true),
    intent: data?.intent || 'GENERAL_PINIT_HELP',
    title: data?.title || '',
    spoken: data?.spoken || data?.answer || '',
    answer: data?.answer,
    confidence: data?.confidence,
    blocks: Array.isArray(data?.blocks) ? data.blocks : [],
    links: Array.isArray(data?.links) ? data.links : [],
    resolved: data?.resolved,
  };
}

export function AskPinitPanel() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('ask');
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>(() => readStoredTurns());
  const [insights, setInsights] = useState<AskPinitInsights | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const questionRef = useRef('');
  const loadingRef = useRef(false);
  const listeningRef = useRef(false);
  const committedVoiceRef = useRef('');
  const threadRef = useRef<HTMLDivElement>(null);
  const vaultId = vaultIdFromPath(location.pathname);
  const pageAssetId = trackingAssetIdFromPath(location.pathname);

  useEffect(() => {
    questionRef.current = question;
  }, [question]);

  useEffect(() => {
    try {
      const keep = turns.filter((t) => t.reply || t.error).slice(-40);
      localStorage.setItem(ASK_CHAT_KEY, JSON.stringify(keep));
    } catch {
      /* ignore quota */
    }
  }, [turns]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getAskPinitInsights()
      .then((data) => { if (!cancelled) setInsights(data); })
      .catch(() => { if (!cancelled) setInsights(null); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 40);
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, loading]);

  useEffect(() => () => {
    listeningRef.current = false;
    recRef.current?.stop();
    window.speechSynthesis?.cancel();
  }, []);

  function stopSpeak() {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }

  function speakText(text: string) {
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  }

  function applyVoiceText(committed: string, interim: string) {
    const text = `${committed} ${interim}`.replace(/\s+/g, ' ').trim();
    questionRef.current = text;
    setQuestion(text);
  }

  function stopListening(send: boolean) {
    listeningRef.current = false;
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
    const text = (committedVoiceRef.current || questionRef.current).trim();
    committedVoiceRef.current = '';
    if (send && text.length >= 2) void submit(text, true);
  }

  async function toggleListen(e?: { preventDefault: () => void; stopPropagation: () => void }) {
    e?.preventDefault();
    e?.stopPropagation();
    if (speaking) {
      stopSpeak();
      return;
    }
    const SR = speechCtor();
    if (!SR) {
      setError('Voice needs Chrome or Edge. You can still type your question.');
      return;
    }
    if (listeningRef.current) {
      stopListening(true);
      return;
    }
    setError('');
    stopSpeak();
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        setError('Microphone permission is blocked. Allow the mic, then tap again.');
        return;
      }
    }
    committedVoiceRef.current = questionRef.current.trim() ? `${questionRef.current.trim()} ` : '';
    const rec = new SR();
    rec.lang = 'en-IN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const piece = ev.results[i]?.[0]?.transcript ?? '';
        if (ev.results[i]?.isFinal) committedVoiceRef.current += piece;
        else interim += piece;
      }
      applyVoiceText(committedVoiceRef.current, interim);
    };
    rec.onerror = (ev) => {
      const code = ev.error || '';
      if (code === 'aborted') return;
      listeningRef.current = false;
      setListening(false);
      if (code === 'not-allowed') setError('Microphone permission is blocked. Allow the mic, then tap again.');
      else if (code === 'no-speech') setError('No speech heard. Tap the mic and ask again.');
      else if (code === 'network') setError('Voice service could not connect. Type your question, or tap the mic again.');
      else if (code) setError('Voice input failed. Type your question, or tap the mic again.');
    };
    rec.onend = () => {
      if (listeningRef.current) {
        try {
          rec.start();
        } catch {
          stopListening(Boolean(committedVoiceRef.current.trim().length >= 2));
        }
      }
    };
    recRef.current = rec;
    listeningRef.current = true;
    setListening(true);
    try {
      rec.start();
    } catch {
      listeningRef.current = false;
      setListening(false);
      setError('Could not start the microphone. Type your question, or tap the mic again.');
    }
  }

  async function submit(raw: string, fromVoice = false) {
    const text = (raw || questionRef.current).trim();
    if (text.length < 2 || loadingRef.current) return;
    loadingRef.current = true;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setTab('ask');
    setLoading(true);
    setError('');
    setQuestion('');
    questionRef.current = '';
    setTurns((prev) => [...prev, { id, question: text, reply: null }]);
    try {
      const conversation = turns.flatMap((t) => (t.reply?.resolved ? [t.reply.resolved] : []));
      const data = normalizeReply(await askPinit(text, {
        vaultId,
        pathname: location.pathname,
        assetId: pageAssetId,
        conversation,
      }));
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, reply: data } : t)));
      if (fromVoice && (data.spoken || data.answer)) {
        speakText(data.spoken || data.answer || '');
      }
    } catch (e) {
      const message = formatApiError(e) || 'Could not reach PINIT Intelligence.';
      setError(message);
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, error: message } : t)));
    } finally {
      loadingRef.current = false;
      setLoading(false);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }

  const insightRows = [
    insights && insights.activitiesToday > 0
      ? { icon: Clock, title: `${insights.activitiesToday} new ${insights.activitiesToday === 1 ? 'activity' : 'activities'}`, detail: 'New events recorded on your assets' }
      : null,
    insights && insights.sharesCreatedToday > 0
      ? { icon: Link2, title: `${insights.sharesCreatedToday} new secure ${insights.sharesCreatedToday === 1 ? 'link' : 'links'}`, detail: 'A share link was created' }
      : null,
    insights && insights.downloadsToday > 0
      ? { icon: Download, title: `${insights.downloadsToday} protected ${insights.downloadsToday === 1 ? 'download' : 'downloads'}`, detail: 'Your assets were downloaded' }
      : null,
  ].filter(Boolean) as Array<{ icon: LucideIcon; title: string; detail: string }>;

  const ui = (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pinit-ask-fab fixed z-[80] right-4 lg:right-5 bottom-[5.5rem] lg:bottom-6 flex items-center gap-2 rounded-full bg-dna-500 text-white pl-3.5 pr-4 py-2.5 shadow-lg ring-1 ring-black/10 hover:bg-dna-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          aria-label="Ask PINIT"
        >
          <Sparkles size={15} className="text-sky-300" />
          <span className="text-[13px] font-semibold tracking-tight">Ask PINIT</span>
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[90] pointer-events-none">
          <button
            type="button"
            className="absolute inset-0 pointer-events-auto bg-black/40 sm:bg-transparent"
            aria-label="Close Ask PINIT"
            onClick={() => setOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="PINIT Intelligence"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="pinit-intel-rail pinit-intel-float pointer-events-auto absolute z-10 flex flex-col overflow-hidden
              inset-x-0 bottom-0 max-h-[min(85dvh,720px)] rounded-t-2xl
              sm:inset-auto sm:right-4 sm:bottom-[5.5rem] lg:bottom-6 sm:w-[400px] sm:max-h-[min(720px,calc(100dvh-6.5rem))] sm:rounded-2xl"
          >
            <div className="pinit-intel flex flex-col h-full min-h-0 text-white">
              <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-500/20 ring-1 ring-sky-400/30">
                      <Sparkles size={15} className="text-sky-300" />
                    </span>
                    <div>
                      <p className="text-[15px] font-semibold tracking-tight">PINIT Intelligence</p>
                      <p className="text-[11px] text-sky-200/70">Your assets know their story.</p>
                    </div>
                  </div>
                  <p className="text-[12px] text-slate-400 mt-3 leading-relaxed">
                    Ask about your assets, activity, protection, sharing, history, or anything you own.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1 rounded-lg text-slate-500 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
                  aria-label="Close Ask PINIT"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="px-5 flex items-center gap-1.5">
                {(['ask', 'insights', 'help'] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold capitalize ${
                      tab === id ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {id === 'ask' ? 'Ask' : id === 'insights' ? 'Insights' : 'Help'}
                  </button>
                ))}
              </div>

              <div ref={threadRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
                {tab === 'ask' && (
                  <div className="min-h-full flex flex-col justify-end space-y-3">
                    {turns.length === 0 && (
                      <p className="text-[12px] text-slate-500 px-1 pb-2">
                        Ask about an asset you shared, who opened it, or where it was opened.
                      </p>
                    )}
                    {turns.map((turn) => (
                      <div key={turn.id} className="space-y-2">
                        <div className="rounded-xl bg-sky-500/15 ring-1 ring-sky-400/20 px-3 py-2">
                          <p className="text-[10px] font-semibold text-sky-200/80 mb-0.5">You</p>
                          <p className="text-[13px] text-white leading-relaxed">{turn.question}</p>
                        </div>
                        {turn.reply && (
                          <div className="rounded-xl bg-[#0b1224] ring-1 ring-white/10 px-3 py-2 space-y-1.5">
                            <p className="text-[10px] font-semibold text-slate-500">PINIT</p>
                            {turn.reply.title ? (
                              <p className="text-[13px] font-semibold text-white">{turn.reply.title}</p>
                            ) : null}
                            {(turn.reply.blocks ?? []).map((b, i) => (
                              <p
                                key={`${turn.id}-${i}`}
                                className={
                                  b.kind === 'heading'
                                    ? 'text-[12px] font-medium text-slate-100'
                                    : b.kind === 'note'
                                      ? 'text-[11px] text-slate-500 italic'
                                      : 'text-[12px] text-slate-300'
                                }
                              >
                                {b.text}
                              </p>
                            ))}
                            {(turn.reply.links ?? []).length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {turn.reply.links.map((l) => (
                                  <Link
                                    key={l.href + l.label}
                                    to={l.href}
                                    className="text-[11px] font-medium px-2 py-1 rounded-lg bg-sky-500/15 text-sky-200 ring-1 ring-sky-400/20"
                                  >
                                    {l.label}
                                  </Link>
                                ))}
                              </div>
                            )}
                            {turn.reply.spoken ? (
                              speaking ? (
                                <button type="button" onClick={stopSpeak} className="inline-flex items-center gap-1 text-[11px] text-rose-300">
                                  <VolumeX size={12} /> Stop speaking
                                </button>
                              ) : (
                                <button type="button" onClick={() => speakText(turn.reply!.spoken)} className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                                  <Volume2 size={12} /> Hear this answer
                                </button>
                              )
                            ) : null}
                          </div>
                        )}
                        {turn.error && <p className="text-[12px] text-rose-400 px-1">{turn.error}</p>}
                        {!turn.reply && !turn.error && (
                          <p className="text-[11px] text-slate-500 px-1">PINIT is checking your records…</p>
                        )}
                      </div>
                    ))}
                    {error && turns.length === 0 && <p className="text-xs text-rose-400">{error}</p>}
                  </div>
                )}

                {tab === 'insights' && (
                  <InsightsList rows={insightRows} empty="No new recorded events today." />
                )}

                {tab === 'help' && (
                  <div className="space-y-3 text-[12px] text-slate-400 leading-relaxed px-1">
                    <p className="flex items-start gap-2 text-slate-300">
                      <HelpCircle size={14} className="mt-0.5 shrink-0 text-sky-300" />
                      Answers are built from your Hub records only.
                    </p>
                    <p><span className="text-white font-medium">Recorded fact</span> — taken from Vault, sharing, tracking, or verification rows.</p>
                    <p><span className="text-white font-medium">Derived</span> — a count or summary of those rows.</p>
                    <p><span className="text-white font-medium">Unknown</span> — PINIT does not have that evidence.</p>
                    <p>On a Living Asset page, “this” or “me” means the asset you are viewing.</p>
                  </div>
                )}
              </div>

              <div className="px-4 pb-4 pt-2">
                <div className={`flex items-center gap-2 rounded-full bg-[#0b1224] ring-1 pl-2 pr-1.5 py-1.5 ${
                  listening ? 'ring-rose-400/50' : speaking ? 'ring-sky-400/40' : 'ring-white/10'
                }`}>
                  <button
                    type="button"
                    onClick={toggleListen}
                    className={`p-2 rounded-full ${
                      listening
                        ? 'bg-rose-500 text-white animate-pulse'
                        : speaking
                          ? 'bg-sky-500/20 text-sky-200'
                          : 'text-slate-400 hover:text-white'
                    }`}
                    aria-label={listening ? 'Stop recording' : speaking ? 'Stop speaking' : 'Talk to PINIT'}
                    title={listening ? 'Stop' : speaking ? 'Stop speaking' : 'Voice'}
                  >
                    {listening ? <Square size={15} /> : speaking ? <VolumeX size={15} /> : <Mic size={15} />}
                  </button>
                  <input
                    ref={inputRef}
                    value={question}
                    onChange={(e) => {
                      questionRef.current = e.target.value;
                      setQuestion(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (listeningRef.current) stopListening(true);
                        else void submit(questionRef.current);
                      }
                    }}
                    placeholder={listening ? 'Listening… tap stop when you’re done' : speaking ? 'Speaking… tap to stop' : 'Ask PINIT anything...'}
                    className="flex-1 min-w-0 bg-transparent text-[13px] outline-none text-white placeholder:text-slate-500"
                  />
                  {listening ? (
                    <button
                      type="button"
                      onClick={() => stopListening(true)}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500 text-white"
                      aria-label="Stop and send"
                    >
                      <Square size={13} />
                    </button>
                  ) : speaking ? (
                    <button
                      type="button"
                      onClick={stopSpeak}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-500 text-white"
                      aria-label="Stop speaking"
                    >
                      <VolumeX size={15} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void submit(questionRef.current);
                      }}
                      disabled={loading || question.trim().length < 2}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-500 text-white disabled:opacity-40"
                      aria-label="Send question"
                    >
                      <ArrowUp size={15} />
                    </button>
                  )}
                </div>
                {listening && (
                  <p className="text-[11px] text-rose-300/90 px-3 pt-1.5">Listening — your words appear here. Tap stop when finished.</p>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );

  return createPortal(ui, document.body);
}

function InsightsList({
  rows,
  empty,
}: {
  rows: Array<{ icon: LucideIcon; title: string; detail: string }>;
  empty?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between px-1 mb-2">
        <p className="text-[12px] font-semibold text-white">Recent insights</p>
        <p className="text-[11px] text-slate-500">Today</p>
      </div>
      {rows.length === 0 && (
        <p className="text-[11px] text-slate-500 px-1">{empty ?? 'No new recorded events today.'}</p>
      )}
      <div className="space-y-1">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <div key={row.title} className="flex items-start gap-3 px-2.5 py-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
                <Icon size={14} />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-white">{row.title}</p>
                <p className="text-[11px] text-slate-500">{row.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: {
    resultIndex: number;
    results: ArrayLike<{ isFinal?: boolean; 0: { transcript: string } }>;
  }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
