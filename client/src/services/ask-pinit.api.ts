import { api } from './dashboard.api';
import { API_BASE_URL } from '../config/api.config';

export type AskPinitCitation = 'recorded' | 'derived' | 'unknown';

export interface AskPinitBlock {
  kind: 'heading' | 'fact' | 'note' | 'event';
  text: string;
  citation: AskPinitCitation;
}

export interface AskPinitLink {
  label: string;
  href: string;
}

export interface AskPinitReply {
  success: boolean;
  intent: string;
  title: string;
  spoken: string;
  answer?: string;
  confidence?: number;
  blocks: AskPinitBlock[];
  links: AskPinitLink[];
  resolved?: { vaultId?: string; assetId?: string | null; filename?: string };
}

export interface AskPinitInsights {
  activitiesToday: number;
  sharesCreatedToday: number;
  downloadsToday: number;
}

export async function askPinit(
  question: string,
  context?: {
    vaultId?: string;
    pathname?: string;
    assetId?: string;
    conversation?: Array<{ vaultId?: string; assetId?: string | null; filename?: string }>;
  },
): Promise<AskPinitReply> {
  const { data } = await api.post<AskPinitReply>(`${API_BASE_URL}/intelligence/ask`, {
    question,
    vaultId: context?.vaultId,
    pathname: context?.pathname,
    assetId: context?.assetId,
    conversation: context?.conversation,
    context: {
      route: context?.pathname,
      assetId: context?.assetId,
      vaultId: context?.vaultId,
    },
  });
  return data;
}

export async function getAskPinitInsights(): Promise<AskPinitInsights> {
  const { data } = await api.get<AskPinitInsights & { success: boolean }>(`${API_BASE_URL}/intelligence/ask/insights`);
  return data;
}

export type LivingAssetBrief = {
  line1: string;
  line2: string;
  spoken: string;
  source: 'vision' | 'clip' | 'document' | 'pixels' | 'fallback';
};

export async function getLivingAssetBrief(vaultId: string): Promise<LivingAssetBrief> {
  const { data } = await api.get<LivingAssetBrief & { success: boolean }>(
    `${API_BASE_URL}/intelligence/living-brief/${encodeURIComponent(vaultId)}`,
    { timeout: 120_000, headers: { 'Cache-Control': 'no-cache' } },
  );
  return data;
}
