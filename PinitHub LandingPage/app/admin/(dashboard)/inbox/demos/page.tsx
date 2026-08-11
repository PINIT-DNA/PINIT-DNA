import Link from 'next/link';
import { StatusPill } from '@/components/admin/StatusPill';
import { DEMO_STATUSES } from '@/lib/defaults';
import { requireUser } from '@/lib/auth/server';
import { prisma } from '@/lib/prisma';

export default async function AdminDemosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireUser('ADMIN');
  const { status } = await searchParams;
  const filter = status && (DEMO_STATUSES as readonly string[]).includes(status) ? status : undefined;

  const rows = await prisma.demoRequest.findMany({
    where: filter ? { status: filter } : undefined,
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-paper">Demo requests</h1>
      <p className="mt-1.5 text-[0.9375rem] text-mute-2">
        {rows.length} request{rows.length === 1 ? '' : 's'}
        {filter ? ` — ${filter}` : ''}
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <FilterLink label="All" active={!filter} href="/admin/inbox/demos" />
        {DEMO_STATUSES.map((s) => (
          <FilterLink key={s} label={s} active={filter === s} href={`/admin/inbox/demos?status=${s}`} />
        ))}
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[720px] text-left text-[0.8125rem]">
          <thead className="border-b border-line bg-ink-2/60 text-mute-2">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Requested</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Received</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-b-0 hover:bg-white/[0.02]">
                <td className="px-4 py-3">
                  <Link href={`/admin/inbox/demos/${r.id}`} className="text-paper hover:text-cyan">
                    {r.name}
                  </Link>
                  <p className="text-mute-2">{r.email}</p>
                </td>
                <td className="px-4 py-3 text-mute">{r.company}</td>
                <td className="px-4 py-3 text-mute">
                  {r.date} · {r.time}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={r.status} />
                </td>
                <td className="px-4 py-3 text-mute-2">{r.createdAt.toLocaleDateString()}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-mute-2">
                  No requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterLink({ label, active, href }: { label: string; active: boolean; href: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3.5 py-1.5 text-[0.75rem] transition-colors ${
        active ? 'border-cyan/45 bg-cyan/10 text-cyan' : 'border-line text-mute-2 hover:text-paper'
      }`}
    >
      {label}
    </Link>
  );
}
