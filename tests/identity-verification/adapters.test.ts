/**
 * Adapter, checksum and classification tests. All personal data is invented,
 * except the ICAO 9303 specimen passport (a published test document).
 */
import { icaoCheckDigit, isValidAadhaarNumber, verhoeffCheckDigit, verhoeffValid } from '../../src/services/identity-verification/checksums';
import { classify, registeredTypes } from '../../src/services/identity-verification/registry';
import { passportAdapter, findTd3, td3CheckResults } from '../../src/services/identity-verification/adapters/passport';
import { aadhaarAdapter } from '../../src/services/identity-verification/adapters/aadhaar';
import { panAdapter } from '../../src/services/identity-verification/adapters/pan';
import { drivingLicenceAdapter } from '../../src/services/identity-verification/adapters/driving-licence';
import { voterIdAdapter } from '../../src/services/identity-verification/adapters/voter-id';
import { parseDate, parseMrzDate } from '../../src/services/identity-verification/normalize';

const NOW = new Date('2026-10-07T00:00:00Z');
const ctx = { now: NOW, documentIndex: 0 };

/** A Verhoeff-valid, made-up Aadhaar-format number. */
export function sampleAadhaar(prefix = '23456789012'): string {
  return prefix + verhoeffCheckDigit(prefix);
}

// ICAO 9303 Part 4 specimen (TD3).
export const ICAO_SPECIMEN = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<< L898902C36UTO7408122F1204159ZE184226B<<<<<10';

describe('checksums', () => {
  it('Verhoeff: known value and generated check digits', () => {
    expect(verhoeffValid('2363')).toBe(true);
    expect(verhoeffValid('2364')).toBe(false);
    for (const p of ['23456789012', '98765432109', '50000000001']) {
      expect(verhoeffValid(p + verhoeffCheckDigit(p))).toBe(true);
    }
  });

  it('Aadhaar: 12 digits, not starting with 0/1, checksum valid', () => {
    const n = sampleAadhaar();
    expect(isValidAadhaarNumber(n)).toBe(true);
    expect(isValidAadhaarNumber(n.slice(0, 11) + ((+n[11]! + 1) % 10))).toBe(false);
    const one = '1' + n.slice(1);
    expect(isValidAadhaarNumber(one)).toBe(false);
  });

  it('ICAO check digits on the specimen', () => {
    expect(icaoCheckDigit('L898902C3')).toBe(6);
    expect(icaoCheckDigit('740812')).toBe(2);
    expect(icaoCheckDigit('120415')).toBe(9);
  });
});

describe('dates', () => {
  it('parses day-first and month-name dates, rejects impossible ones', () => {
    expect(parseDate('01/02/2000')).toBe('2000-02-01');
    expect(parseDate('15-AUG-1990')).toBe('1990-08-15');
    expect(parseDate('31/02/2000')).toBeNull();
    expect(parseMrzDate('740812', 'birth', NOW)).toBe('1974-08-12');
    expect(parseMrzDate('120415', 'expiry', NOW)).toBe('2012-04-15');
  });
});

describe('passport adapter', () => {
  it('reads the specimen MRZ with every check digit correct', () => {
    const mrz = findTd3(ICAO_SPECIMEN)!;
    expect(Object.values(td3CheckResults(mrz)).every(Boolean)).toBe(true);
    const f = passportAdapter.extract(ICAO_SPECIMEN, ctx);
    expect(f.fullName?.value).toBe('ANNA MARIA ERIKSSON');
    expect(f.documentNumber?.value).toBe('L898902C3');
    expect(f.dateOfBirth?.value).toBe('1974-08-12');
    expect(f.gender?.value).toBe('F');
    expect(f.dateOfBirth?.source).toBe('MRZ');
    const findings = passportAdapter.validate(f, ctx, ICAO_SPECIMEN);
    expect(findings.map((x) => x.code)).toEqual(expect.arrayContaining(['CHECKSUM_VALID', 'DOCUMENT_EXPIRED']));
  });

  it('flags an altered MRZ digit', () => {
    const altered = ICAO_SPECIMEN.replace('7408122F', '7408132F');
    const f = passportAdapter.extract(altered, ctx);
    const codes = passportAdapter.validate(f, ctx, altered).map((x) => x.code);
    expect(codes).toContain('CHECKSUM_INVALID');
  });
});

describe('aadhaar adapter', () => {
  const n = sampleAadhaar();
  const grouped = `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}`;
  const front = `Government of India Test Person DOB: 01/01/2000 FEMALE ${grouped}`;

  it('extracts name, DOB, gender and a checksum-valid number', () => {
    const f = aadhaarAdapter.extract(front, ctx);
    expect(f.fullName?.value).toBe('Test Person');
    expect(f.dateOfBirth?.value).toBe('2000-01-01');
    expect(f.gender?.value).toBe('FEMALE');
    expect(f.documentNumber?.value).toBe(n);
    expect(aadhaarAdapter.validate(f, ctx, front).map((x) => x.code)).toContain('CHECKSUM_VALID');
  });

  it('flags a number that fails the checksum', () => {
    const bad = front.replace(grouped, `${grouped.slice(0, -1)}${(+grouped.slice(-1) + 1) % 10}`);
    const f = aadhaarAdapter.extract(bad, ctx);
    expect(aadhaarAdapter.validate(f, ctx, bad).map((x) => x.code)).toContain('CHECKSUM_INVALID');
  });

  it('keeps an uncertain OCR spelling and does not rewrite it', () => {
    const text = 'Teeest Person\nDOB: 01/01/2000 FEMALE';
    const f = aadhaarAdapter.extract(text, ctx);
    expect(f.fullName?.value).toBe('Teeest Person');
    expect(f.fullName?.status).toBe('NEEDS_REVIEW');
  });

  it('finds the name when a stray mark sits on its own line between the name and the date', () => {
    const t = (text: string, x0: number, y0: number, confidence = 90) => ({ text, confidence, x0, y0, x1: x0 + 60, y1: y0 + 30 });
    const tokens = [
      t('Saigo', 500, 287, 33), t('efigH', 600, 287, 0),
      t('Test', 500, 333, 89), t('Person', 600, 333, 92),
      t(';', 840, 340, 63),
      t('S8/DOB:', 500, 385, 16), t('01/01/2000', 700, 395, 96),
      t('FEMALE', 560, 471, 96),
    ];
    const f = aadhaarAdapter.extract('Test Person\nDOB: 01/01/2000\nFEMALE', { ...ctx, tokens });
    expect(f.fullName?.value).toBe('Test Person');
    expect(f.fullName?.status).toBe('READ');
  });

  it('keeps a checksum failure as review and does not change the digits', () => {
    const bad = `${grouped.slice(0, -1)}${(+grouped.slice(-1) + 1) % 10}`;
    const f = aadhaarAdapter.extract(`Test Person\nDOB: 01/01/2000 FEMALE\n${bad}`, ctx);
    expect(f.documentNumber?.value).toBe(bad.replace(/\s/g, ''));
    expect(f.documentNumber?.status).toBe('NEEDS_REVIEW');
  });

  it('keeps the name words and the 12-digit line at the bottom, not the VID', () => {
    const text = `Government of India efigH Teest Person DE DOB: 01/01/2000 FEMALE ${grouped} VID 9173 2648 1530 4826`;
    const f = aadhaarAdapter.extract(text, ctx);
    expect(f.fullName?.value).toBe('Teest Person');
    expect(f.documentNumber?.value).toBe(n);
  });

  it('reads a name that sits before the date, and a number with uneven spacing', () => {
    const spaced = n.split('').join(' ');
    const text = `ASHWITHA KAVVAM DOB: 01/01/2000 FEMALE ${spaced}`;
    const f = aadhaarAdapter.extract(text, ctx);
    expect(f.fullName?.value).toBe('ASHWITHA KAVVAM');
    expect(f.dateOfBirth?.value).toBe('2000-01-01');
    expect(f.documentNumber?.value).toBe(n);
  });

  it('accepts a masked Aadhaar without claiming a checksum', () => {
    const f = aadhaarAdapter.extract('Unique Identification Authority of India Test Person Year of Birth: 1995 MALE XXXX XXXX 4321', ctx);
    expect(f.documentNumber?.value).toBe('XXXXXXXX4321');
    expect(f.yearOfBirth?.value).toBe('1995');
    const codes = aadhaarAdapter.validate(f, ctx, '').map((x) => x.code);
    expect(codes).not.toContain('CHECKSUM_VALID');
    expect(codes).not.toContain('CHECKSUM_INVALID');
  });
});

describe('PAN adapter', () => {
  const text = 'INCOME TAX DEPARTMENT GOVT. OF INDIA Permanent Account Number Card ABCPR1234F Name / TEST REDDY Father\'s Name / SAMPLE REDDY Date of Birth 01/01/2000';
  it('reads the number, name, father and DOB, and checks the holder type', () => {
    const f = panAdapter.extract(text, ctx);
    expect(f.documentNumber?.value).toBe('ABCPR1234F');
    expect(f.fullName?.value).toBe('TEST REDDY');
    expect(f.fatherOrGuardianName?.value).toBe('SAMPLE REDDY');
    expect(f.dateOfBirth?.value).toBe('2000-01-01');
    expect(panAdapter.validate(f, ctx, text).map((x) => x.code)).toContain('NUMBER_STRUCTURE_VALID');
  });
  it('flags a company PAN presented as a person', () => {
    const f = panAdapter.extract(text.replace('ABCPR1234F', 'ABCCR1234F'), ctx);
    const findings = panAdapter.validate(f, ctx, '');
    expect(findings.some((x) => x.code === 'NUMBER_STRUCTURE_INVALID' && /company/i.test(x.message))).toBe(true);
  });
});

describe('driving licence adapter', () => {
  const text = 'Union of India Driving Licence Telangana Transport Department DL No TS09 2015 0012345 Name: Test Person S/O Sample Person DOB: 01/01/1990 Date of Issue: 10/05/2015 Valid Till: 09/05/2035 COV LMV MCWG';
  it('reads the number, dates and vehicle classes and checks the structure', () => {
    const f = drivingLicenceAdapter.extract(text, ctx);
    expect(f.documentNumber?.value).toBe('TS0920150012345');
    expect(f.dateOfBirth?.value).toBe('1990-01-01');
    expect(f.issueDate?.value).toBe('2015-05-10');
    expect(f.expiryDate?.value).toBe('2035-05-09');
    expect(f.vehicleClasses?.value).toBe('LMV, MCWG');
    const codes = drivingLicenceAdapter.validate(f, ctx, text).map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['NUMBER_STRUCTURE_VALID', 'DOCUMENT_NOT_EXPIRED']));
  });
  it('flags an unknown state code, an expired licence and an under-age holder', () => {
    const f = drivingLicenceAdapter.extract(
      text.replace('TS09', 'ZZ09').replace('09/05/2035', '09/05/2020').replace('01/01/1990', '01/01/2005'), ctx);
    const codes = drivingLicenceAdapter.validate(f, ctx, '').map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['NUMBER_STRUCTURE_INVALID', 'DOCUMENT_EXPIRED', 'UNDERAGE_FOR_DOCUMENT']));
  });
});

describe('voter ID adapter', () => {
  it('reads the EPIC number and flags a minor', () => {
    const text = "ELECTION COMMISSION OF INDIA ELECTOR PHOTO IDENTITY CARD ABC1234567 Elector's Name: Test Person Father's Name: Sample Person Gender: FEMALE Date of Birth: 01/01/2012";
    const f = voterIdAdapter.extract(text, ctx);
    expect(f.documentNumber?.value).toBe('ABC1234567');
    expect(f.fullName?.value).toBe('Test Person');
    expect(voterIdAdapter.validate(f, ctx, text).map((x) => x.code)).toEqual(expect.arrayContaining(['NUMBER_STRUCTURE_VALID', 'UNDERAGE_FOR_DOCUMENT']));
  });
});

describe('document-specific fields added by the field brief', () => {
  it("PAN: reads a mother's name when printed instead of the father's", () => {
    const f = panAdapter.extract("INCOME TAX DEPARTMENT Permanent Account Number Card ABCPR1234F Name / TEST REDDY Mother's Name / SAMPLE DEVI Date of Birth 01/01/2000", ctx);
    expect(f.motherName?.value).toBe('SAMPLE DEVI');
    expect(f.fatherOrGuardianName).toBeUndefined();
  });

  it('Voter ID: reads year of birth, assembly constituency and part number', () => {
    const f = voterIdAdapter.extract("ELECTION COMMISSION OF INDIA ABC1234567 Elector's Name: Test Person Year of Birth: 1990 Assembly Constituency No. & Name: 52 - Jubilee Hills Part No. & Name: 123 Sample Ward", ctx);
    expect(f.yearOfBirth?.value).toBe('1990');
    expect(f.electoralConstituency?.value).toBe('52 - Jubilee Hills');
    expect(f.electoralPartNumber?.value).toBe('123');
  });

  it('Passport: flags a printed number that differs from the MRZ', () => {
    const text = `Passport No. Z1234567 ${ICAO_SPECIMEN}`;
    const f = passportAdapter.extract(text, ctx);
    const findings = passportAdapter.validate(f, ctx, text);
    expect(findings.some((x) => x.code === 'STRUCTURE_INCONSISTENT' && x.field === 'documentNumber')).toBe(true);
  });

  it('declares the elements each document normally carries', () => {
    expect(passportAdapter.expectedElements).toEqual(['PHOTOGRAPH', 'SIGNATURE', 'MRZ']);
    expect(aadhaarAdapter.expectedElements).toEqual(['PHOTOGRAPH']);
    expect(panAdapter.expectedElements).toEqual(['PHOTOGRAPH', 'SIGNATURE']);
  });
});

describe('classification', () => {
  it('ships every adapter the brief asks for', () => {
    expect(registeredTypes()).toEqual(['PASSPORT', 'AADHAAR', 'PAN', 'DRIVING_LICENCE', 'VOTER_ID', 'GOVERNMENT_ID']);
  });
  it('recognises each document without a declared type', () => {
    expect(classify(ICAO_SPECIMEN).type).toBe('PASSPORT');
    expect(classify(`Government of India Test Person DOB: 01/01/2000 FEMALE ${sampleAadhaar().replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3')}`).type).toBe('AADHAAR');
    expect(classify('INCOME TAX DEPARTMENT Permanent Account Number ABCPR1234F').type).toBe('PAN');
    expect(classify('ELECTION COMMISSION OF INDIA ABC1234567').type).toBe('VOTER_ID');
  });
  it('reports when the chosen type does not match the document', () => {
    const c = classify('INCOME TAX DEPARTMENT Permanent Account Number ABCPR1234F', 'PASSPORT');
    expect(c.type).toBe('PAN');
    expect(c.declaredMismatch).toEqual({ declared: 'PASSPORT', looksLike: 'PAN' });
  });
  it('does not recognise unrelated text', () => {
    expect(classify('Invoice number 1234 total amount due').type).toBeNull();
  });
});
