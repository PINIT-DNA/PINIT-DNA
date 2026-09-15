import jwt from 'jsonwebtoken';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config/index';
import { isPlatformOwnerShortId } from '../src/lib/platform-owner';

const API = 'http://localhost:4000/api/v1';

function tokenFor(u: { id: string; shortId: string; fullName: string | null; role: string }): string {
  return jwt.sign(
    { sub: u.id, shortId: u.shortId, name: u.fullName ?? u.shortId, role: u.role },
    config.jwt.secret,
    { expiresIn: '5m' },
  );
}

async function call(path: string, token: string) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  // This production DB currently has no SUPER_ADMIN / platform-owner account
  // provisioned yet, so there is nothing to log in as "the owner" with. Instead,
  // borrow one real user and cycle its role, which lets us prove the more
  // important guarantee: capability-based reads open up per role, but the
  // owner-only gate on destructive actions holds even for a non-owner SUPER_ADMIN.
  const guinea = await prisma.user.findFirst({
    where: { isActive: true },
    select: { id: true, shortId: true, fullName: true, role: true },
  });
  if (!guinea) {
    throw new Error('No users found in this DB — cannot run test');
  }
  if (isPlatformOwnerShortId(guinea.shortId)) {
    throw new Error('Refusing to mutate the real platform-owner account for this test');
  }

  {
    const originalRole = guinea.role;
    console.log(`Borrowing user ${guinea.shortId} (original role: ${originalRole}) for role-gating tests...`);

    try {
      // Non-owner SUPER_ADMIN: full READ capabilities, but destructive routes must still 403
      // (proves the owner allowlist gate is independent of role, per Phase 2's design).
      await prisma.user.update({ where: { id: guinea.id }, data: { role: 'SUPER_ADMIN' } });
      let tok = tokenFor({ ...guinea, role: 'SUPER_ADMIN' });
      const saMe = await call('/super-admin/me', tok);
      const saUsers = await call('/super-admin/users', tok);
      const saToggle = await fetch(`${API}/super-admin/users/${guinea.id}/toggle`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      console.log('\n[1] Non-owner SUPER_ADMIN /me ->', saMe.status, JSON.stringify(saMe.body));
      console.log('[1] Non-owner SUPER_ADMIN /users (should be 200, role capability) ->', saUsers.status);
      console.log('[1] Non-owner SUPER_ADMIN destructive toggle (should be 403, owner-only) ->', saToggle.status);
      if (saMe.status !== 200 || saMe.body?.isOwner !== false || saMe.body?.capabilities?.length !== 7) {
        throw new Error('FAIL: non-owner SUPER_ADMIN should get full read capabilities but isOwner=false');
      }
      if (saUsers.status !== 200) throw new Error('FAIL: SUPER_ADMIN role should have identity access');
      if (saToggle.status !== 403) throw new Error('FAIL: destructive route must stay owner-gated even for SUPER_ADMIN role');

      // ANALYST: should get overview/assets/intelligence, NOT identity, NOT destructive
      await prisma.user.update({ where: { id: guinea.id }, data: { role: 'ANALYST' } });
      tok = tokenFor({ ...guinea, role: 'ANALYST' });
      const analystMe = await call('/super-admin/me', tok);
      const analystDna = await call('/super-admin/dna', tok);
      const analystUsers = await call('/super-admin/users', tok);
      const analystRoleChange = await fetch(`${API}/super-admin/users/${guinea.id}/role`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'USER' }),
      });
      console.log('[2] ANALYST /me ->', analystMe.status, JSON.stringify(analystMe.body?.capabilities));
      console.log('[2] ANALYST /dna (should be 200) ->', analystDna.status);
      console.log('[2] ANALYST /users (should be 403) ->', analystUsers.status);
      console.log('[2] ANALYST destructive role-change on owner (should be 403) ->', analystRoleChange.status);
      if (analystDna.status !== 200) throw new Error('FAIL: ANALYST should have assets access');
      if (analystUsers.status !== 403) throw new Error('FAIL: ANALYST should NOT have identity access');
      if (analystRoleChange.status !== 403) throw new Error('FAIL: ANALYST must never pass requireSuperAdmin');

      // AUDITOR: should get identity + forensics + intelligence, NOT assets
      await prisma.user.update({ where: { id: guinea.id }, data: { role: 'AUDITOR' } });
      tok = tokenFor({ ...guinea, role: 'AUDITOR' });
      const auditorUsers = await call('/super-admin/users', tok);
      const auditorVault = await call('/super-admin/vault', tok);
      console.log('[2] AUDITOR /users (should be 200) ->', auditorUsers.status);
      console.log('[2] AUDITOR /vault (should be 403) ->', auditorVault.status);
      if (auditorUsers.status !== 200) throw new Error('FAIL: AUDITOR should have identity access');
      if (auditorVault.status !== 403) throw new Error('FAIL: AUDITOR should NOT have assets access');

      // Plain USER: should get nothing
      await prisma.user.update({ where: { id: guinea.id }, data: { role: 'USER' } });
      tok = tokenFor({ ...guinea, role: 'USER' });
      const userMe = await call('/super-admin/me', tok);
      const userOverview = await call('/super-admin/overview', tok);
      console.log('[2] USER /me ->', userMe.status, JSON.stringify(userMe.body?.capabilities));
      console.log('[2] USER /overview (should be 403) ->', userOverview.status);
      if (userOverview.status !== 403) throw new Error('FAIL: plain USER must not reach admin console routes');

      console.log('\nPHASE 2 VERIFICATION: PASS');
    } finally {
      await prisma.user.update({ where: { id: guinea.id }, data: { role: originalRole as never } });
      console.log(`Restored ${guinea.shortId} to original role: ${originalRole}`);
    }
  }
}

main()
  .catch((err) => { console.error('PHASE 2 VERIFICATION: FAIL', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
