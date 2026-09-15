import { requireUser } from '@/lib/auth/server';
import { prisma } from '@/lib/prisma';

export default async function AdminAuditLogPage() {
  await requireUser('OWNER');
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-paper">Audit log</h1>
      <p className="mt-1.5 text-[0.9375rem] text-mute-2">Most recent {logs.length} events.</p>

      <div className="mt-6 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[720px] text-left text-[0.8125rem]">
          <thead className="border-b border-line bg-ink-2/60 text-mute-2">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Collection</th>
              <th className="px-4 py-3 font-medium">Summary</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-line last:border-b-0 hover:bg-white/[0.02]">
                <td className="px-4 py-3 whitespace-nowrap text-mute-2">{log.createdAt.toLocaleString()}</td>
                <td className="px-4 py-3 text-paper">{log.userEmail}</td>
                <td className="px-4 py-3 text-cyan">{log.action}</td>
                <td className="px-4 py-3 text-mute">{log.collection}</td>
                <td className="px-4 py-3 text-mute-2">{log.summary || '—'}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-mute-2">
                  No activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
