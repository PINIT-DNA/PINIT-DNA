export const ORGANIZATION_INDUSTRIES = [
  'MEDIA',
  'LEGAL',
  'EDUCATION',
  'TECHNOLOGY',
  'HEALTHCARE',
  'AGENCY',
  'OTHER',
] as const;

export type OrganizationIndustry = (typeof ORGANIZATION_INDUSTRIES)[number];

export const ORGANIZATION_SIZES = [
  'SOLO',
  'SMALL',
  'MEDIUM',
  'LARGE',
  'XLARGE',
] as const;

export type OrganizationSize = (typeof ORGANIZATION_SIZES)[number];

export const ORGANIZATION_INDUSTRY_LABELS: Record<OrganizationIndustry, string> = {
  MEDIA: 'Media',
  LEGAL: 'Legal',
  EDUCATION: 'Education',
  TECHNOLOGY: 'Technology',
  HEALTHCARE: 'Healthcare',
  AGENCY: 'Agency',
  OTHER: 'Other',
};

export const ORGANIZATION_SIZE_LABELS: Record<OrganizationSize, string> = {
  SOLO: '1',
  SMALL: '2–10',
  MEDIUM: '11–50',
  LARGE: '51–200',
  XLARGE: '200+',
};

export function isOrganizationIndustry(value: string): value is OrganizationIndustry {
  return (ORGANIZATION_INDUSTRIES as readonly string[]).includes(value);
}

export function isOrganizationSize(value: string): value is OrganizationSize {
  return (ORGANIZATION_SIZES as readonly string[]).includes(value);
}
