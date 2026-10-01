import {
  extractSearchTokens,
  questionRefersToCurrentAsset,
  questionUsesFollowUpPronoun,
} from './ask-pinit-intent';

export type ResolvableAsset = {
  vaultId: string;
  assetId: string | null;
  dnaRecordId: string;
  filename: string;
  sha256: string | null;
};

export type ConversationHint = {
  vaultId?: string;
  assetId?: string;
  filename?: string;
};

function scoreName(filename: string, tokens: string[]): number {
  const n = filename.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (n.includes(t)) score += t.length;
  }
  return score;
}

function byId(vaults: ResolvableAsset[], id: string | undefined): ResolvableAsset | null {
  if (!id) return null;
  const q = id.toLowerCase();
  return vaults.find((v) =>
    v.vaultId.toLowerCase() === q
    || v.dnaRecordId.toLowerCase() === q
    || (v.assetId && v.assetId.toLowerCase() === q)
    || (v.sha256 && (v.sha256.toLowerCase() === q || v.sha256.toLowerCase().startsWith(q)))
  ) ?? null;
}

export function lastConversationAsset(turns: ConversationHint[] | undefined): ConversationHint | null {
  if (!turns?.length) return null;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.vaultId || t.assetId || t.filename) return t;
  }
  return null;
}

export function resolveAsset(
  vaults: ResolvableAsset[],
  question: string,
  opts?: {
    contextVaultId?: string;
    conversation?: ConversationHint[];
  },
): ResolvableAsset | null {
  if (!vaults.length) return null;

  const fromPath = opts?.contextVaultId?.trim();
  if (fromPath && questionRefersToCurrentAsset(question)) {
    return byId(vaults, fromPath) ?? vaults.find((v) => v.vaultId === fromPath) ?? null;
  }

  const tokens = extractSearchTokens(question);
  if (/\b(latest|most recently protected|last protected|most recent asset)\b/i.test(question) && !tokens.length) {
    return vaults[0] ?? null;
  }
  if (/\b(first asset|first .{0,24}protected|oldest)\b/i.test(question) && !tokens.length) {
    return vaults[vaults.length - 1] ?? null;
  }

  const idMatch = question.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (idMatch) {
    const hit = byId(vaults, idMatch[0]);
    if (hit) return hit;
  }

  if (tokens.length) {
    const ranked = vaults
      .map((v) => ({ v, s: scoreName(v.filename, tokens) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    if (ranked.length >= 2 && ranked[0].s === ranked[1].s) return null;
    if (ranked[0]) return ranked[0].v;
    const idToken = tokens.find((t) => t.length >= 8);
    if (idToken) {
      const hit = byId(vaults, idToken)
        ?? vaults.find((v) => v.sha256?.toLowerCase().includes(idToken));
      if (hit) return hit;
    }
  }

  const prior = lastConversationAsset(opts?.conversation);
  if (prior && (questionUsesFollowUpPronoun(question) || (tokens.length === 0 && !/^(hi|hii|hey|hello)\b/i.test(question.trim())))) {
    return byId(vaults, prior.vaultId)
      ?? byId(vaults, prior.assetId)
      ?? (prior.filename
        ? vaults.find((v) => v.filename.toLowerCase() === prior.filename!.toLowerCase()) ?? null
        : null);
  }

  if (fromPath && (questionUsesFollowUpPronoun(question) || tokens.length === 0 || questionRefersToCurrentAsset(question))) {
    return byId(vaults, fromPath);
  }

  if (vaults.length === 1 && (
    questionRefersToCurrentAsset(question)
    || questionUsesFollowUpPronoun(question)
    || /\b(my|that|this|the) asset\b/i.test(question)
  )) {
    return vaults[0];
  }
  if (fromPath) return byId(vaults, fromPath);
  return null;
}
