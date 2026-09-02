/** Map API/network failures to copy a shopper can act on. Log the raw text separately. */

export function publicErrorMessage(raw, status = 0) {
  const text = String(raw || '').trim();
  const lower = text.toLowerCase();
  if (status === 401 || lower.includes('session has expired') || lower.includes('authentication failed')) {
    return 'Your session has expired.';
  }
  if (
    status === 0
    || status === 503
    || status === 504
    || lower.includes('failed to fetch')
    || lower.includes('cannot reach')
    || lower.includes('timed out')
    || lower.includes('empty response')
  ) {
    return 'Pinit Exchange is temporarily waking up.';
  }
  if (status === 502 && (lower.includes('payment') || lower.includes('razorpay') || lower.includes('gateway'))) {
    return text.length > 160 ? "Payment couldn't be started. Try Pay again." : (text || "Payment couldn't be started. Try Pay again.");
  }
  if (status >= 500) return 'Pinit Exchange is temporarily waking up.';
  if (lower.includes('payment') && (lower.includes('fail') || lower.includes('could not') || lower.includes('verification'))) {
    return "Payment couldn't be completed.";
  }
  if (/sql|prisma|econn|stack|exception|undefined is not/i.test(text) || text.length > 160) {
    return 'Something went wrong. Please try again.';
  }
  return text || 'Something went wrong. Please try again.';
}
