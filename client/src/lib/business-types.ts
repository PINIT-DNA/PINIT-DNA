export const BUSINESS_TYPES = [
  'STARTUP',
  'SME',
  'ENTERPRISE',
  'AGENCY',
  'UNIVERSITY',
  'LEGAL_FIRM',
  'GOVERNMENT',
  'MEDIA_HOUSE',
  'OTHER',
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  STARTUP: 'Startup',
  SME: 'SME',
  ENTERPRISE: 'Enterprise',
  AGENCY: 'Agency',
  UNIVERSITY: 'University',
  LEGAL_FIRM: 'Legal Firm',
  GOVERNMENT: 'Government',
  MEDIA_HOUSE: 'Media House',
  OTHER: 'Other',
};

export function isBusinessType(value: string): value is BusinessType {
  return (BUSINESS_TYPES as readonly string[]).includes(value);
}
