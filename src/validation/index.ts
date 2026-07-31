/**
 * Validation Readiness public surface.
 * Framework only — does not wire into production investigation paths.
 */

export * from './types';
export * from './stage-once.verifier';
export * from './validation-report.builder';
export * from './gold-dataset.manifest';
export * from './e2e-validation.runner';
export * from './regression.scaffolding';
