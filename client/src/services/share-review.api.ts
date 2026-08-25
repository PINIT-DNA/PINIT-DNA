/**
 * Client review through a secure share link.
 *
 * Public by design — the token IS the authority, so these calls deliberately
 * use bare axios rather than the JWT-carrying `api` instance. A reviewing
 * client has no Pinit account and must never be asked for one.
 */
import axios from 'axios';
import { API_BASE_URL } from '../config/api.config';
import type { CommentAnchor, CommentKind, ReviewComment, CommentThreads } from './business.api';

export interface ClientReviewVersion {
  id: string;
  versionNumber: number;
  reviewStatus: string;
  createdAt: string;
  changeSummary: string | null;
  isCurrent: boolean;
  superseded: boolean;
}

export interface ClientReviewContext {
  filename: string;
  versionId: string;
  versionNumber: number;
  reviewStatus: string;
  allowComments: boolean;
  allowChangeRequest: boolean;
  allowApproval: boolean;
  /** True when the sender required identity verification and it hasn't happened. */
  requiresIdentityCheck: boolean;
  recipientLabel: string;
  versions: ClientReviewVersion[];
}

/**
 * Returns null when this link simply is not a review link — that is the normal
 * case for every share created before review mode, and must not surface as an
 * error in the viewer.
 */
export async function getShareReview(token: string): Promise<ClientReviewContext | null> {
  try {
    const { data } = await axios.get<{ success: boolean; review: ClientReviewContext }>(
      `${API_BASE_URL}/share/${token}/review`,
    );
    return data?.review ?? null;
  } catch (err) {
    // 404 = not a review link (the common case). 403 = review turned off or
    // link revoked. Neither is an error worth surfacing over someone's file.
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404 || status === 403) return null;
    throw err;
  }
}

export async function getShareReviewComments(token: string): Promise<CommentThreads> {
  const { data } = await axios.get<{ success: boolean } & CommentThreads>(
    `${API_BASE_URL}/share/${token}/review/comments`,
  );
  return {
    comments: Array.isArray(data?.comments) ? data.comments : [],
    counts: data?.counts ?? { open: 0, resolved: 0, openChangeRequests: 0 },
  };
}

export async function postShareReviewComment(
  token: string,
  input: { body: string; kind?: CommentKind; parentId?: string | null; anchor?: CommentAnchor | null; authorLabel?: string },
): Promise<ReviewComment> {
  const { data } = await axios.post<{ success: boolean; comment: ReviewComment }>(
    `${API_BASE_URL}/share/${token}/review/comments`, input,
  );
  return data.comment;
}

// ── Decisions ────────────────────────────────────────────────────────────────

export type ApprovalDecision = 'APPROVED' | 'CHANGES_REQUESTED';

export interface VersionDecision {
  id: string;
  decision: ApprovalDecision;
  comment: string | null;
  approverLabel: string;
  byClient: boolean;
  identityVerified: boolean;
  versionId: string;
  assetId: string;
  createdAt: string;
}

export async function getShareReviewDecisions(token: string): Promise<VersionDecision[]> {
  const { data } = await axios.get<{ success: boolean; decisions: VersionDecision[] }>(
    `${API_BASE_URL}/share/${token}/review/decisions`,
  );
  return Array.isArray(data?.decisions) ? data.decisions : [];
}

export async function postShareReviewDecision(
  token: string,
  input: { decision: ApprovalDecision; comment?: string; approverLabel?: string },
): Promise<{ approval: VersionDecision; reviewStatus: string }> {
  const { data } = await axios.post<{ success: boolean; approval: VersionDecision; reviewStatus: string }>(
    `${API_BASE_URL}/share/${token}/review/decision`, input,
  );
  return { approval: data.approval, reviewStatus: data.reviewStatus };
}
