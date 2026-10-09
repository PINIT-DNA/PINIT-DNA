import {
  buildVerifiedIdentityData, maskAddress, maskDate, maskNumber, tidyName, viewVerifiedDetails,
} from '../../src/services/identity-verification/verified-details';
import type { VerificationResult } from '../../src/services/identity-verification/types';

const field = (value: string, status: 'READ' | 'VALIDATED' | 'NEEDS_REVIEW' = 'READ') => ({ value, confidence: 0.9, source: 'OCR' as const, status });

function result(status: VerificationResult['status'], documents: unknown[]): VerificationResult {
  return { status, documents } as unknown as VerificationResult;
}

const aadhaar = {
  detectedType: 'AADHAAR',
  fields: {
    fullName: field('Test Person'),
    documentNumber: field('234567890124', 'VALIDATED'),
    dateOfBirth: field('2000-01-01', 'VALIDATED'),
    gender: field('FEMALE'),
    address: field('D/O Someone, 12-3 Main Road, Hyderabad, Telangana 500001'),
  },
};

describe('verified identity details', () => {
  const now = new Date('2026-10-08T05:00:00Z');

  it('keeps nothing unless the identity checks passed', () => {
    for (const status of ['REVIEW_REQUIRED', 'REJECTED', 'INSUFFICIENT_EVIDENCE'] as const) {
      expect(buildVerifiedIdentityData(result(status, [aadhaar]), 'run-1', now)).toBeNull();
    }
  });

  it('builds the stored details from a passed run', () => {
    const data = buildVerifiedIdentityData(result('CHECKS_PASSED', [aadhaar]), 'run-1', now)!;
    expect(data.fullName).toBe('Test Person');
    expect(data.documentNumber).toBe('234567890124');
    expect(data.dateOfBirth).toBe('2000-01-01');
    expect(data.gender).toBe('FEMALE');
    expect(data.address).toContain('Hyderabad');
    expect(data.primaryType).toBe('AADHAAR');
    expect(data.runId).toBe('run-1');
  });

  it('leaves out a value that was flagged for review instead of storing it as right', () => {
    const doc = { detectedType: 'AADHAAR', fields: { ...aadhaar.fields, fullName: field('Teest Person', 'NEEDS_REVIEW') } };
    const data = buildVerifiedIdentityData(result('CHECKS_PASSED', [doc]), null, now)!;
    expect(data.fullName).toBeNull();
    expect(data.documentNumber).toBe('234567890124');
  });

  it('takes the name from whichever document has one and keeps each document apart', () => {
    const pan = { detectedType: 'PAN', fields: { fullName: field('TEST PERSON'), documentNumber: field('ABCPR1234F', 'VALIDATED') } };
    const noName = { detectedType: 'AADHAAR', fields: { documentNumber: field('234567890124', 'VALIDATED') } };
    const data = buildVerifiedIdentityData(result('CHECKS_PASSED', [noName, pan]), null, now)!;
    expect(data.fullName).toBe('Test Person');
    expect(data.documents.map((d) => d.type)).toEqual(['AADHAAR', 'PAN']);
  });

  it('writes capital-letter names in normal case and leaves mixed case alone', () => {
    expect(tidyName('RAVI KUMAR  REDDY')).toBe('Ravi Kumar Reddy');
    expect(tidyName("D'SOUZA-ALI")).toBe("D'Souza-Ali");
    expect(tidyName('Test Person')).toBe('Test Person');
  });

  it('masks sensitive values unless the owner reveals them', () => {
    const data = buildVerifiedIdentityData(result('CHECKS_PASSED', [aadhaar]), null, now)!;
    const masked = viewVerifiedDetails(data, false);
    expect(masked.documentNumber).toBe('••••••••0124');
    expect(masked.dateOfBirth).toBe('••/••/2000');
    expect(masked.address).not.toContain('Main Road');
    expect(masked.fullName).toBe('Test Person');
    const shown = viewVerifiedDetails(data, true);
    expect(shown.documentNumber).toBe('234567890124');
    expect(shown.dateOfBirth).toBe('2000-01-01');
    expect(shown.address).toContain('Main Road');
  });

  it('masks safely when values are missing or short', () => {
    expect(maskNumber(null)).toBeNull();
    expect(maskNumber('1234')).toBe('••••');
    expect(maskDate(null)).toBeNull();
    expect(maskAddress('Hyderabad')).toBe('••••••••');
  });
});
