import { NewsletterRow } from '@/components/admin/NewsletterRow';
import { requireUser } from '@/lib/auth/server';
import { prisma } from '@/lib/prisma';

export default async function AdminNewsletterPage() {
  await requireUser('ADMIN');
  const rows = await prisma.newsletterSubscriber.findMany({ orderBy: { createdAt: 'desc' } });
  const activeCount = rows.filter((r) => r.active).length;

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-paper">Newsletter</h1>
      <p className="mt-1.5 text-[0.9375rem] text-mute-2">
        {activeCount} active of {rows.length} total.
      </p>

      <div className="mt-6 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[560px] text-left text-[0.8125rem]">
          <thead className="border-b border-line bg-ink-2/60 text-mute-2">
            <tr>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Subscribed</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <NewsletterRow
                key={r.id}
                id={r.id}
                email={r.email}
                source={r.source}
                active={r.active}
                createdAt={r.createdAt.toLocaleDateString()}
              />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-mute-2">
                  No subscribers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
