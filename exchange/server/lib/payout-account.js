import crypto from 'crypto';

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function normalizeAccountNumber(raw) {
  return String(raw ?? '').replace(/\s+/g, '');
}

export function normalizeIfsc(raw) {
  return String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Accepts a payout account only when the two account numbers match and the
 * IFSC is a real-shaped code. Nothing is stored when this returns an error.
 */
export function reviewPayoutAccount({ holder, accountNumber, confirmAccountNumber, ifsc }) {
  const name = String(holder ?? '').trim().replace(/\s+/g, ' ');
  const account = normalizeAccountNumber(accountNumber);
  const confirm = normalizeAccountNumber(confirmAccountNumber);
  const code = normalizeIfsc(ifsc);

  if (name.length < 2 || name.length > 80) {
    return { ok: false, error: 'Enter the account holder name.' };
  }
  if (!/^[A-Za-z][A-Za-z .'-]{1,79}$/.test(name)) {
    return { ok: false, error: 'The account holder name can use letters only.' };
  }
  if (!/^\d{9,18}$/.test(account)) {
    return { ok: false, error: 'Enter the bank account number, 9 to 18 digits.' };
  }
  if (account !== confirm) {
    return { ok: false, error: 'The account numbers do not match.' };
  }
  if (!IFSC.test(code)) {
    return { ok: false, error: 'Enter a valid IFSC, like HDFC0001234.' };
  }

  return {
    ok: true,
    value: {
      holder: name,
      ifsc: code,
      last4: account.slice(-4),
      fingerprint: crypto.createHash('sha256').update(`${code}|${account}`).digest('hex'),
    },
  };
}
