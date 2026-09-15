import { prisma } from '../src/lib/prisma';
import { adminAuditService } from '../src/services/audit/admin-audit.service';

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true, shortId: true } });
  if (!user) throw new Error('No user found to attribute a test audit event to');

  console.log('Recording a test admin-audit event as actor:', user.id, user.shortId);

  await adminAuditService.record({
    actorUserId: user.id,
    actorShortId: user.shortId,
    action: 'phase1.smoke_test',
    targetType: 'SmokeTest',
    targetId: 'phase1-verify',
    before: { status: 'before' },
    after: { status: 'after' },
    reason: 'Phase 1 verification — safe to delete',
  });

  const rows = await adminAuditService.list({ action: 'phase1.smoke_test', limit: 5 });
  console.log('Rows found:', rows.length);
  console.log(JSON.stringify(rows[0], null, 2));

  if (rows.length === 0) throw new Error('FAILED: no row was written');

  // Clean up the smoke-test row (this table has no delete-block, unlike DnaRecord)
  await prisma.adminAuditEvent.deleteMany({ where: { action: 'phase1.smoke_test' } });
  console.log('Cleaned up smoke-test row.');
  console.log('PHASE 1 VERIFICATION: PASS');
}

main()
  .catch((err) => { console.error('PHASE 1 VERIFICATION: FAIL', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
