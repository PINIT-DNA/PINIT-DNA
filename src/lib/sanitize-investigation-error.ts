/** Hide Prisma/stack dumps from investigation UI — keep actionable user text. */
export function sanitizeInvestigationError(raw: string): string {
  const text = (raw || '').trim();
  if (!text) return 'Investigation could not complete — please retry.';

  if (/can'?t reach database server|P1001|timed out fetching a new connection|ConnectionReset|ECONNREFUSED|ENOTFOUND/i.test(text)) {
    return 'Database temporarily unreachable. Check your internet connection and Supabase status, then retry the investigation. (DNA vault lookup needs the database.)';
  }
  if (/P2024|connection pool|Server has closed the connection/i.test(text)) {
    return 'Database connection pool busy or dropped. Wait a moment and retry.';
  }
  if (/Invalid `prisma\./i.test(text) || /prisma\.[a-z]+\./i.test(text)) {
    if (/database|supabase|pooler/i.test(text)) {
      return 'Database temporarily unreachable. Check your internet connection and Supabase status, then retry.';
    }
    return 'A database error interrupted this investigation. Please retry. If it persists, restart the backend.';
  }
  if (text.length > 280 || /at Object\.|node_modules|\\src\\services\\/i.test(text)) {
    const first = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('at ') && !l.startsWith('→'));
    if (first && first.length < 200 && !/prisma|Invocation/i.test(first)) return first;
    return 'Investigation could not complete due to an internal error. Please retry.';
  }
  return text.slice(0, 280);
}
