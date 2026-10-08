import { format, isToday, isYesterday, startOfDay } from 'date-fns';
import type { VaultTrackingDashboard } from '../services/dashboard.api';

export function firstName(full?: string | null) {
  const t = (full ?? '').trim();
  if (!t) return 'the owner';
  return t.split(/\s+/)[0] ?? t;
}

export type BriefingActivity = {
  at: string;
  title: string;
  detail?: string;
  kind: 'activity' | 'investigation' | 'origin';
};

export type LiveBriefing = {
  about: string[];
  activity: string[];
  spoken: string;
  latest: BriefingActivity[];
};

export type BriefingEvent = {
  at: string;
  title: string;
  detail?: string;
  kind?: BriefingActivity['kind'];
};

function whenLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (isToday(d)) return `Today · ${format(d, 'h:mm a')}`;
  if (isYesterday(d)) return `Yesterday · ${format(d, 'h:mm a')}`;
  return format(d, 'd MMM · h:mm a');
}

function fileKind(mime?: string | null, name?: string | null) {
  const m = (mime || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (m.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic)$/.test(n)) return 'photograph';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio recording';
  if (m.includes('pdf') || n.endsWith('.pdf')) return 'document';
  return 'protected file';
}

export function buildLiveBriefing(opts: {
  createdAt: string;
  ownerName?: string | null;
  locationLabel?: string | null;
  tracking?: VaultTrackingDashboard | null;
  hasIdentity: boolean;
  shareCount: number;
  viewCount: number;
  downloadCount: number;
  mimeType?: string | null;
  fileName?: string | null;
  deviceModel?: string | null;
  captureMethod?: string | null;
  sceneLabel?: string | null;
  tamperLabel?: string | null;
  tamperVerified?: boolean;
  events: BriefingEvent[];
}): LiveBriefing {
  const who = (opts.ownerName ?? '').trim().split(/\s+/)[0];
  const when = format(new Date(opts.createdAt), 'd MMMM yyyy');
  const place = opts.locationLabel?.trim();
  const kind = fileKind(opts.mimeType, opts.fileName);
  const about: string[] = [];

  about.push(`I am an original ${kind} captured on ${when}${place ? ` in ${place}` : ''}.`);

  if (who) about.push(`I was protected by ${who} and preserved in PinIT Vault.`);
  else about.push('I was preserved in PinIT Vault.');

  if (opts.hasIdentity) about.push('My identity is registered with a PinIT protection record.');

  if (opts.tamperVerified) about.push('My current protection status is verified.');
  else if (opts.tamperLabel && /tamper/i.test(opts.tamperLabel)) about.push(`My recorded tamper status is ${opts.tamperLabel}.`);
  else about.push('I am stored as a protected asset in PinIT Vault.');

  if (opts.deviceModel) about.push(`I was recorded from ${opts.deviceModel}.`);
  else if (opts.captureMethod) about.push(`I was captured by ${opts.captureMethod}.`);

  if (opts.sceneLabel) about.push(`Stored analysis describes me as: ${opts.sceneLabel}.`);

  const latest = [...opts.events]
    .filter((e) => e.at && e.title)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 8)
    .map((e) => ({
      at: e.at,
      title: e.title,
      detail: e.detail,
      kind: e.kind ?? 'activity',
    }));

  const todayStart = startOfDay(new Date()).getTime();
  const todayEvents = latest.filter((e) => new Date(e.at).getTime() >= todayStart && e.kind !== 'origin');
  const activity: string[] = [];

  if (opts.shareCount > 0 || opts.viewCount > 0 || opts.downloadCount > 0) {
    const bits: string[] = [];
    if (opts.shareCount > 0) bits.push(`shared across ${opts.shareCount} secure link${opts.shareCount === 1 ? '' : 's'}`);
    if (opts.viewCount > 0) bits.push(`viewed ${opts.viewCount} time${opts.viewCount === 1 ? '' : 's'}`);
    if (opts.downloadCount > 0) bits.push(`downloaded ${opts.downloadCount} time${opts.downloadCount === 1 ? '' : 's'}`);
    if (bits.length) activity.push(`I have been ${bits.join(', ')}.`);
  }

  if (todayEvents.length) {
    const titles = [...new Set(todayEvents.map((e) => e.title))].slice(0, 3);
    activity.push(`Today, recorded activity includes: ${titles.join('; ')}.`);
  } else if (!opts.shareCount && !opts.viewCount && !opts.downloadCount) {
    activity.push('There has been no new activity on me today. I remain protected.');
  }

  const investigations = latest.filter((e) => e.kind === 'investigation');
  if (investigations.length) {
    activity.push(`An investigation or evidence event is on record: ${investigations[0].title}.`);
  }

  return {
    about,
    activity,
    spoken: [...about, ...activity].join(' '),
    latest,
  };
}

export function activityWhenLabel(iso: string) {
  return whenLabel(iso);
}

export function buildAssetStoryLines(opts: {
  createdAt: string;
  ownerName?: string | null;
  locationLabel?: string | null;
  tracking?: VaultTrackingDashboard | null;
  hasIdentity: boolean;
  shareCount: number;
  viewCount: number;
}): string[] {
  return buildLiveBriefing({
    ...opts,
    downloadCount: 0,
    events: [],
  }).about;
}

export function buildAssetSpokenStory(opts: {
  createdAt: string;
  ownerName?: string | null;
  locationLabel?: string | null;
  tracking?: VaultTrackingDashboard | null;
  hasIdentity: boolean;
  shareCount: number;
  viewCount: number;
}): string {
  return buildAssetStoryLines(opts).join(' ');
}

const CREATOR_NOTE_KEY = (vaultId: string) => `pinit_creator_note_${vaultId}`;

export function readCreatorNote(vaultId: string): { text: string; updatedAt: string | null } {
  try {
    const raw = localStorage.getItem(CREATOR_NOTE_KEY(vaultId));
    if (!raw) return { text: '', updatedAt: null };
    const parsed = JSON.parse(raw) as { text?: string; updatedAt?: string };
    return { text: typeof parsed.text === 'string' ? parsed.text : '', updatedAt: parsed.updatedAt ?? null };
  } catch {
    return { text: '', updatedAt: null };
  }
}

export function writeCreatorNote(vaultId: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    localStorage.removeItem(CREATOR_NOTE_KEY(vaultId));
    return { text: '', updatedAt: null as string | null };
  }
  const updatedAt = new Date().toISOString();
  localStorage.setItem(CREATOR_NOTE_KEY(vaultId), JSON.stringify({ text: trimmed, updatedAt }));
  return { text: trimmed, updatedAt };
}

export function storyHighlights(_opts: {
  hasIdentity: boolean;
  hasLocation: boolean;
  hasShares: boolean;
  isProtected: boolean;
}): { title: string; detail: string }[] {
  return [
    { title: 'I am Original', detail: 'Captured with PinIT Secure Capture' },
    { title: 'I have an Identity', detail: 'Unique PinIT Origin ID' },
    { title: 'I have a Memory', detail: 'Time, place, and every step are tracked' },
    { title: 'I have a Journey', detail: "I've been shared, seen and verified" },
    { title: 'I am Protected', detail: 'My DNA is safe. My origin is true.' },
    { title: 'I will live forever', detail: 'I will always be remembered' },
  ];
}
