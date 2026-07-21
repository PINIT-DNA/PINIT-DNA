/**
 * Configurable subscription limits — env overrides with safe defaults.
 * Consumed by plan definitions and entitlement checks.
 */

import { config } from '../../../config';

export const planLimits = {
  /** Max protected vault assets on Free (any account type). */
  freeAssetLimit: config.subscription.freeAssetLimit,
  /** Business Free pilot: max team members (includes admin). */
  businessFreeTeamLimit: config.subscription.businessFreeTeamLimit,
  /** Business Free pilot: max workspaces. */
  businessFreeWorkspaceLimit: config.subscription.businessFreeWorkspaceLimit,
} as const;
