/**
 * The canonical Pinit certificate renderer now lives in `shared/certificate/`, so
 * Hub, Portfolio and Exchange all draw the same sheet from one source. There is no
 * Hub-specific certificate design.
 *
 * This file stays as the Hub's import path so every existing caller — the preview
 * modal, the PDF download and the public verification page — keeps working
 * unchanged.
 */
export {
  PinitCertificateDocument as PinitCredentialDocument,
  PinitCertificateDocument,
} from '@pinit/certificate';
