import { Link } from 'react-router-dom';
import { Copy, HelpCircle, Shield, Share2, MapPin, Radio } from 'lucide-react';
import toast from 'react-hot-toast';

const SUPPORT_EMAIL = 'hello@pinithub.com';

const TOPICS = [
  {
    icon: Shield,
    title: 'Protect a file',
    body: 'Use Protect New to store the original in your vault. The master file stays in Hub — you share a controlled link, not the raw file.',
    to: '/generate',
    cta: 'Protect New',
  },
  {
    icon: Share2,
    title: 'Share and track access',
    body: 'From My Assets, create a share link. Views, downloads, copy, screenshot, and reshare attempts are logged for that link.',
    to: '/vault',
    cta: 'My Assets',
  },
  {
    icon: MapPin,
    title: 'See who opened it (map)',
    body: 'Open Asset Activity, then the share. Pins use GPS when the viewer allows location; otherwise Hub shows approximate city from IP.',
    to: '/access-intelligence',
    cta: 'Asset Activity',
  },
  {
    icon: Radio,
    title: 'Licensed Exchange files',
                body: 'Purchases open a Hub share page — never a raw API/JWT URL. Activity for those links appears under Asset Activity for the vault owner.',
    to: '/access-intelligence',
    cta: 'Asset Activity',
  },
];

export function HelpPage() {
  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      toast.success('Support email copied');
    } catch {
      toast.error(`Copy this address: ${SUPPORT_EMAIL}`);
    }
  };

  return (
    <div className="page-shell max-w-3xl space-y-8">
      <div>
        <div className="flex items-center gap-2 text-slate-400 mb-2">
          <HelpCircle size={18} />
          <span className="text-xs font-semibold uppercase tracking-widest">Help</span>
        </div>
        <h1 className="text-2xl font-bold text-white">How Pinit HUB works</h1>
        <p className="text-sm text-slate-400 mt-2 leading-relaxed">
          Short answers for protecting files, sharing with tracking, and reading the activity map.
          This stays in the app — it does not open your email program.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {TOPICS.map(({ icon: Icon, title, body, to, cta }) => (
          <div key={title} className="card p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Icon size={16} className="text-dna-400" />
              <h2 className="text-sm font-semibold text-white">{title}</h2>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed flex-1">{body}</p>
            <Link to={to} className="text-xs font-medium text-dna-400 hover:text-dna-300">
              {cta} →
            </Link>
          </div>
        ))}
      </div>

      <div className="card p-5 space-y-3">
        <h2 className="text-sm font-semibold text-white">Need a person?</h2>
        <p className="text-xs text-slate-400 leading-relaxed">
          Write to the support inbox from whatever mail app you already use. We copy the address
          so Windows does not launch Outlook from this page.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="text-xs px-2 py-1 rounded-lg bg-bg-elevated border border-bg-border text-slate-200">
            {SUPPORT_EMAIL}
          </code>
          <button
            type="button"
            onClick={() => void copyEmail()}
            className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
          >
            <Copy size={13} /> Copy email
          </button>
          <a
            href="https://www.pinithub.com"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-slate-400 hover:text-white"
          >
            pinithub.com
          </a>
        </div>
      </div>
    </div>
  );
}
