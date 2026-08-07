import type { OrganizationView } from '../hooks/useOrganization';
import type { OrganizationIndustry, OrganizationSize } from './organization-profile';
import { toOrgPinitId, toRootPinitId } from './pinit-identity';

export interface UserProfileSnapshot {
  fullName?: string;
  shortId?: string;
  email?: string | null;
  phone?: string | null;
  organization?: string | null;
  country?: string | null;
  bio?: string | null;
  workspaceName?: string | null;
  organizationIndustry?: OrganizationIndustry | null;
  organizationSize?: OrganizationSize | null;
}

/** Resolve PINIT IDs and labels — org API first, user profile as fallback while provisioning. */
export function resolveOrgIdentity(
  organization: OrganizationView | null,
  profile: UserProfileSnapshot,
  loading = false,
) {
  const ownerRoot = toRootPinitId(profile.shortId) || profile.shortId?.trim() || '';
  const expectedOrgId = toOrgPinitId(ownerRoot);
  // Prefer ID derived from the biometric account so USER/ORG share the same code.
  const orgShortId =
    (organization?.shortId && expectedOrgId && organization.shortId === expectedOrgId
      ? organization.shortId
      : expectedOrgId)
    || organization?.shortId
    || (loading ? 'Loading…' : '');
  const workspaceShortId = organization?.defaultWorkspace?.shortId ?? (loading ? 'Loading…' : '');
  const orgName =
    organization?.name?.trim()
    || profile.organization?.trim()
    || 'Your Organization';
  const workspaceName =
    organization?.defaultWorkspace?.name?.trim()
    || profile.workspaceName?.trim()
    || 'Main Workspace';
  const ownerShortId = ownerRoot;
  const ownerName = profile.fullName?.trim() ?? '';
  const ownerEmail = profile.email?.trim() ?? organization?.supportEmail?.trim() ?? '';

  return {
    orgShortId: orgShortId || '—',
    workspaceShortId: workspaceShortId || '—',
    orgName,
    workspaceName,
    ownerShortId: ownerShortId || '—',
    ownerName,
    ownerEmail,
    industry: organization?.industry ?? profile.organizationIndustry ?? null,
    organizationSize: organization?.organizationSize ?? profile.organizationSize ?? null,
    country: organization?.country ?? profile.country ?? '',
    supportPhone: organization?.supportPhone ?? profile.phone ?? '',
    aboutDescription: organization?.aboutDescription ?? profile.bio ?? '',
  };
}
