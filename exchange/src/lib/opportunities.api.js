/**
 * Opportunities API.
 *
 * Every call goes through apiFetch, which attaches the session token and the
 * Pinit ID header. Nothing here builds a URL by hand or calls fetch directly.
 */
import { apiFetch } from './api.js';

const json = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/* ── Open work ────────────────────────────────────────────────────────── */

export function listBriefs({ vertical } = {}) {
  const q = vertical && vertical !== 'all' ? `?vertical=${encodeURIComponent(vertical)}` : '';
  return apiFetch(`/api/opportunities/briefs${q}`);
}

export function getBrief(reqId) {
  return apiFetch(`/api/opportunities/briefs/${encodeURIComponent(reqId)}`);
}

export function submitProposal(reqId, { assetIds, note, teamId }) {
  return apiFetch(
    `/api/opportunities/briefs/${encodeURIComponent(reqId)}/propose`,
    json({ asset_ids: assetIds, note, team_id: teamId }),
  );
}

export function withdrawProposal(reqId) {
  return apiFetch(`/api/opportunities/briefs/${encodeURIComponent(reqId)}/withdraw`, json({}));
}

export function askQuestion(reqId, body) {
  return apiFetch(`/api/opportunities/briefs/${encodeURIComponent(reqId)}/questions`, json({ body }));
}

/* ── The buyer's side ─────────────────────────────────────────────────── */

export function listMyBriefs() {
  return apiFetch('/api/opportunities/my-briefs');
}

export function listProposals(reqId) {
  return apiFetch(`/api/opportunities/briefs/${encodeURIComponent(reqId)}/proposals`);
}

export function awardBrief(reqId, proposalId) {
  return apiFetch(
    `/api/opportunities/briefs/${encodeURIComponent(reqId)}/award`,
    json({ proposal_id: proposalId }),
  );
}

export function inviteCreators(reqId, pinitIds) {
  return apiFetch(
    `/api/opportunities/briefs/${encodeURIComponent(reqId)}/invite`,
    json({ pinit_ids: pinitIds }),
  );
}

/* ── Collaborate ──────────────────────────────────────────────────────── */

export function listCreators({ q, openOnly } = {}) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (openOnly) params.set('open_only', '1');
  const qs = params.toString();
  return apiFetch(`/api/opportunities/creators${qs ? `?${qs}` : ''}`);
}

export function listCollabs() {
  return apiFetch('/api/opportunities/collabs');
}

export function postCollab({ title, body, lookingFor, reqId }) {
  return apiFetch('/api/opportunities/collabs',
    json({ title, body, looking_for: lookingFor, req_id: reqId }));
}

export function closeCollab(collabId) {
  return apiFetch(`/api/opportunities/collabs/${encodeURIComponent(collabId)}/close`, json({}));
}

export function askToCollaborate({ toPinitId, reason, reqId, collabId }) {
  return apiFetch('/api/opportunities/asks',
    json({ to_pinit_id: toPinitId, reason, req_id: reqId, collab_id: collabId }));
}

export function respondToAsk(askId, decision) {
  return apiFetch(`/api/opportunities/asks/${encodeURIComponent(askId)}/respond`, json({ decision }));
}

/* ── Teams ────────────────────────────────────────────────────────────── */

export function createTeam(reqId, members) {
  return apiFetch(`/api/opportunities/briefs/${encodeURIComponent(reqId)}/team`, json({ members }));
}

export function acceptTeamShare(teamId) {
  return apiFetch(`/api/opportunities/teams/${encodeURIComponent(teamId)}/accept`, json({}));
}

/* ── Shared ───────────────────────────────────────────────────────────── */

export function myActivity() {
  return apiFetch('/api/opportunities/activity');
}

/** The creator's own HUB-protected assets — what a proposal can attach. */
export function myProtectedAssets(pinitId) {
  const q = pinitId ? `?pinit_id=${encodeURIComponent(pinitId)}` : '';
  return apiFetch(`/api/hub/assets${q}`);
}
