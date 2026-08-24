import Link from 'next/link';
import { atLeast } from '@/lib/auth/roles';
import { requireUser } from '@/lib/auth/server';
import { prisma } from '@/lib/prisma';

export default async function AdminDashboardPage() {
  const user = await requireUser('EDITOR');
  const canSeeInbox = atLeast(user.role, 'ADMIN');

  const [newDemos, totalDemos, subscribers, recentAudit] = await Promise.all([
    prisma.demoRequest.count({ where: { status: 'NEW' } }),
    prisma.demoRequest.count(),
    prisma.newsletterSubscriber.count({ where: { active: true } }),
    canSeeInbox ? prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }) : Promise.resolve([]),
  ]);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-paper">
        Welcome back, {user.name.split(' ')[0]}
      </h1>
      <p className="mt-1.5 text-[0.9375rem] text-mute-2">
        Signed in as {user.email} · {user.role}
      </p>

      {canSeeInbox && (
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <StatCard label="New demo requests" value={newDemos} href="/admin/inbox/demos" accent={newDemos > 0} />
          <StatCard label="Total demo requests" value={totalDemos} href="/admin/inbox/demos" />
          <StatCard label="Active subscribers" value={subscribers} href="/admin/inbox/newsletter" />
        </div>
      )}

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-lg font-medium text-paper">Quick links</h2>
          <ul className="mt-4 space-y-2">
            <QuickLink href="/admin/content" label="Edit page content" />
            <QuickLink href="/admin/content/sections" label="Show or hide sections" />
            <QuickLink href="/admin/settings" label="Site settings & SEO" />
            {canSeeInbox && <QuickLink href="/admin/inbox/demos" label="Review demo requests" />}
          </ul>
        </div>

        {canSeeInbox && recentAudit.length > 0 && (
          <div>
            <h2 className="font-display text-lg font-medium text-paper">Recent activity</h2>
            <ul className="mt-4 space-y-3">
              {recentAudit.map((log) => (
                <li key={log.id} className="text-[0.8125rem] text-mute-2">
                  <span className="text-paper">{log.userEmail}</span>{' '}
                  <span className="text-cyan">{log.action}</span> <span className="text-mute">{log.collection}</span>
                  {log.summary && <span> — {log.summary}</span>}
                  <span className="ml-2 text-mute-2/60">{log.createdAt.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
  accent,
}: {
  label: string;
  value: number;
  href: string;
  accent?: boolean;
}) {
  return (
    <Link href={href} className="panel block p-6 transition-transform hover:-translate-y-0.5">
      <p className="eyebrow">{label}</p>
      <p className={`mt-3 font-display text-3xl font-semibold ${accent ? 'text-cyan' : 'text-paper'}`}>{value}</p>
    </Link>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Link href={href} className="text-[0.9375rem] text-mute hover:text-cyan">
        {label} →
      </Link>
    </li>
  );
}
