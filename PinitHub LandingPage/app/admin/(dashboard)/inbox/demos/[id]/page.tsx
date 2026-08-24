import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DemoDetailForm } from '@/components/admin/DemoDetailForm';
import { requireUser } from '@/lib/auth/server';
import { prisma } from '@/lib/prisma';

export default async function AdminDemoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser('ADMIN');
  const { id } = await params;
  const row = await prisma.demoRequest.findUnique({ where: { id } });
  if (!row) notFound();

  return (
    <div className="max-w-3xl">
      <Link href="/admin/inbox/demos" className="text-[0.8125rem] text-mute-2 hover:text-paper">
        ← All demo requests
      </Link>
      <h1 className="mt-3 font-display text-2xl font-semibold text-paper">{row.name}</h1>
      <p className="mt-1 text-[0.9375rem] text-mute-2">
        {row.title} at {row.company}
      </p>

      <dl className="mt-6 grid gap-x-8 gap-y-4 rounded-xl border border-line bg-ink-2/40 p-6 sm:grid-cols-2">
        <Field label="Email" value={row.email} href={`mailto:${row.email}`} />
        <Field label="Phone" value={row.phone || '—'} />
        <Field label="Country" value={row.country} />
        <Field label="Company size" value={row.size} />
        <Field label="Industry" value={row.industry} />
        <Field label="Requested slot" value={`${row.date} at ${row.time}`} />
        <Field label="Source" value={row.source} />
        <Field label="Received" value={row.createdAt.toLocaleString()} />
      </dl>

      {row.message && (
        <div className="mt-6 rounded-xl border border-line bg-ink-2/40 p-6">
          <p className="eyebrow">Message</p>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-mute">{row.message}</p>
        </div>
      )}

      <div className="mt-6">
        <DemoDetailForm id={row.id} status={row.status} notes={row.notes} />
      </div>
    </div>
  );
}

function Field({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div>
      <dt className="eyebrow text-[0.625rem]">{label}</dt>
      <dd className="mt-1 text-[0.9375rem] text-paper">
        {href ? (
          <a href={href} className="hover:text-cyan">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
