/**
 * Enterprise DNA Suite — versioned contracts for the 15 DNA Modules and forensic engines.
 *
 * WHY this file exists (Milestone A / Phase 9):
 * - Centralize EDS-1.0 taxonomy so later milestones (B→L) share one import surface.
 * - No runtime investigation behavior is changed here — constants and types only.
 * - Legacy `DNA_LAYER_REGISTRY_V1` (dna-layer.types.ts) remains for existing UI/report slots;
 *   this registry is the forward-looking module→engine map per docs/PHASE10_ENTERPRISE_DNA_SPECIFICATION.md.
 *
 * Rollback: delete imports of this module; no DB or API impact.
 */

/** Authoritative suite id — bump only with a new EDS revision. */
export const DNA_SUITE_VERSION = 'eds-1.0' as const;

/** Frozen comparison/acceptance policy bundle id (pairs with acceptance-policy-v1.2 today). */
export const DNA_SUITE_POLICY_BUNDLE = 'dna-suite-eds-1.0' as const;

/**
 * Forensic engine roles (EDS P6).
 * Acceptance is a pipeline stage, not a DNA module slot — L15 is Subject Bind under Ownership.
 */
export const DNA_ENGINE_ROLE = {
  IDENTITY: 'identity',
  OWNERSHIP: 'ownership',
  EVIDENCE: 'evidence',
  /** Verdict stage — does not own an L-slot; maps investigation layers slot 15 at report time. */
  ACCEPTANCE: 'acceptance',
} as const;

export type DnaEngineRole = (typeof DNA_ENGINE_ROLE)[keyof typeof DNA_ENGINE_ROLE];

/** Stable public module ids L1–L15 (EDS naming: DNA Module, not "layer"). */
export const DNA_MODULE_IDS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
] as const;

export type DnaModuleId = (typeof DNA_MODULE_IDS)[number];

export interface DnaModuleEdsDefinition {
  id: DnaModuleId;
  /** Short EDS module name */
  name: string;
  /** Which forensic engine owns comparison semantics for this module */
  engineRole: Exclude<DnaEngineRole, typeof DNA_ENGINE_ROLE.ACCEPTANCE>;
  /** One-line purpose — see EDS Part 2 for full spec */
  purpose: string;
}

/**
 * EDS-1.0 module registry — engine assignment is normative for migration milestones D–F.
 *
 * Identity  → L1–L10  ("Is this the same content?")
 * Ownership → L12, L14, L15 ("Who owns it?")
 * Evidence  → L11, L13 ("Legal / risk evidence?")
 */
export const DNA_MODULE_REGISTRY_EDS: ReadonlyArray<DnaModuleEdsDefinition> = [
  { id: 1, name: 'Cryptographic Bitstream Identity', engineRole: DNA_ENGINE_ROLE.IDENTITY, purpose: 'Canonical bitstream content_id' },
  { id: 2, name: 'Structural Geometry', engineRole: DNA_ENGINE_ROLE.IDENTITY, purpose: 'Spatial / document structure' },
  { id: 3, name: 'Perceptual / Content Similarity', engineRole: DNA_ENGINE_ROLE.IDENTITY, purpose: 'Near-duplicate perceptual hash' },
  { id: 4, name: 'Distribution Sketch', engineRole: DNA_ENGINE_ROLE.IDENTITY, purpose: 'Statistical content sketch' },
  { id: 5, name: 'Embedded Provenance Claims', engineRole: DNA_ENGINE_ROLE.IDENTITY, purpose: 'Signed / embedded claims digest' },
  { id: 6, name: 'Content Integrity Seal', engineRole: DNA_ENGINE_ROLE.IDENTITY, purpose: 'HMAC / seal over identity bundle' },
  { id: 7, name: 'Local Patch DNA', engineRole: DNA_ENGINE_ROLE.IDENTITY, purpose: 'Fragment / crop identity' },
  { id: 8, name: 'Content Family', engineRole: DNA_ENGINE_ROLE.IDENTITY, purpose: 'Family / cluster membership' },
  { id: 9, name: 'Cross-Modal Descriptor', engineRole: DNA_ENGINE_ROLE.IDENTITY, purpose: 'Cross-media identity bridge' },
  { id: 10, name: 'Derivation Lineage Head', engineRole: DNA_ENGINE_ROLE.IDENTITY, purpose: 'Derivative lineage pointer' },
  { id: 11, name: 'Synthetic / Manipulation Risk', engineRole: DNA_ENGINE_ROLE.EVIDENCE, purpose: 'Deepfake / tamper risk score' },
  { id: 12, name: 'Recoverable Ownership Mark', engineRole: DNA_ENGINE_ROLE.OWNERSHIP, purpose: 'Extractable watermark / TEP mark' },
  { id: 13, name: 'Custody Anchor', engineRole: DNA_ENGINE_ROLE.EVIDENCE, purpose: 'Custody chain head' },
  { id: 14, name: 'Ownership Commitment', engineRole: DNA_ENGINE_ROLE.OWNERSHIP, purpose: 'Deterministic ownership commitment' },
  { id: 15, name: 'Subject Bind', engineRole: DNA_ENGINE_ROLE.OWNERSHIP, purpose: 'Optional biometric / subject bind' },
] as const;

/** Module ids grouped by engine — used by future Identity / Ownership / Evidence engines. */
export const DNA_MODULES_BY_ENGINE: Readonly<Record<Exclude<DnaEngineRole, typeof DNA_ENGINE_ROLE.ACCEPTANCE>, readonly DnaModuleId[]>> = {
  [DNA_ENGINE_ROLE.IDENTITY]: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  [DNA_ENGINE_ROLE.OWNERSHIP]: [12, 14, 15],
  [DNA_ENGINE_ROLE.EVIDENCE]: [11, 13],
};

/** Resolve EDS engine role for a module id; returns undefined for out-of-range ids. */
export function getDnaModuleEngineRole(moduleId: number): Exclude<DnaEngineRole, typeof DNA_ENGINE_ROLE.ACCEPTANCE> | undefined {
  const entry = DNA_MODULE_REGISTRY_EDS.find((m) => m.id === moduleId);
  return entry?.engineRole;
}

/** True when module contributes to Identity Engine scoring (EDS L1–L10). */
export function isIdentityDnaModule(moduleId: number): boolean {
  return getDnaModuleEngineRole(moduleId) === DNA_ENGINE_ROLE.IDENTITY;
}

/** True when module contributes to Ownership Engine scoring (EDS L12, L14, L15). */
export function isOwnershipDnaModule(moduleId: number): boolean {
  return getDnaModuleEngineRole(moduleId) === DNA_ENGINE_ROLE.OWNERSHIP;
}

/** True when module contributes to Evidence Engine narrative (EDS L11, L13). */
export function isEvidenceDnaModule(moduleId: number): boolean {
  return getDnaModuleEngineRole(moduleId) === DNA_ENGINE_ROLE.EVIDENCE;
}
