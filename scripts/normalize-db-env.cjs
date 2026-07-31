/**
 * Strip quotes / fix @ in password before Prisma CLI or app start (Render env vars).
 */
function normalizePostgresUrl(raw) {
  if (!raw) return raw;

  let url = String(raw).trim();
  if (
    (url.startsWith('"') && url.endsWith('"')) ||
    (url.startsWith("'") && url.endsWith("'"))
  ) {
    url = url.slice(1, -1).trim();
  }

  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    return url;
  }

  try {
    new URL(url);
    return url;
  } catch {
    /* continue */
  }

  const schemeEnd = url.indexOf('://') + 3;
  const scheme = url.slice(0, schemeEnd);
  const rest = url.slice(schemeEnd);

  const qIdx = rest.indexOf('?');
  const query = qIdx >= 0 ? rest.slice(qIdx) : '';
  const pathAndAuth = qIdx >= 0 ? rest.slice(0, qIdx) : rest;

  const slashIdx = pathAndAuth.indexOf('/');
  const dbPath = slashIdx >= 0 ? pathAndAuth.slice(slashIdx) : '';
  const authority = slashIdx >= 0 ? pathAndAuth.slice(0, slashIdx) : pathAndAuth;

  const hostMatch = authority.match(/@([a-z0-9.-]+\.supabase\.com:\d+)$/i);
  if (!hostMatch?.[1]) return url;

  const host = hostMatch[1];
  const hostAt = authority.lastIndexOf(`@${host}`);
  if (hostAt < 0) return url;

  const userinfo = authority.slice(0, hostAt);
  const colon = userinfo.indexOf(':');
  if (colon < 0) return url;

  const user = userinfo.slice(0, colon);
  let pass = userinfo.slice(colon + 1);
  try {
    pass = decodeURIComponent(pass);
  } catch {
    /* keep as-is */
  }
  const encodedPass = encodeURIComponent(pass);

  return `${scheme}${user}:${encodedPass}@${host}${dbPath}${query}`;
}

for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  if (process.env[key]) {
    const fixed = normalizePostgresUrl(process.env[key]);
    if (fixed) process.env[key] = fixed;
  }
}
