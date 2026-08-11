import Link from 'next/link';
import { LIST_REGISTRY, SINGLETON_REGISTRY } from '@/lib/admin/registry';

export default function AdminContentIndexPage() {
  const lists = Object.values(LIST_REGISTRY);
  const singletons = Object.values(SINGLETON_REGISTRY).filter((s) => s.key !== 'siteSettings');

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-paper">Content</h1>
      <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-mute-2">
        Every section of the landing page, editable without a deploy. Changes appear on the live site
        within a few seconds.
      </p>

      <Link
        href="/admin/content/sections"
        className="panel mt-6 block max-w-md p-5 transition-transform hover:-translate-y-0.5"
      >
        <p className="font-display text-[0.9375rem] font-medium text-paper">Section visibility</p>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-mute-2">
          Show, hide, and re-word each section&rsquo;s header.
        </p>
      </Link>

      <h2 className="mt-10 font-display text-sm font-medium tracking-wide text-mute uppercase">Singletons</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {singletons.map((s) => (
          <Card key={s.key} href={`/admin/content/${s.key}`} label={s.label} description={s.description} />
        ))}
      </div>

      <h2 className="mt-10 font-display text-sm font-medium tracking-wide text-mute uppercase">Collections</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {lists.map((c) => (
          <Card key={c.key} href={`/admin/content/${c.key}`} label={c.label} description={c.description} />
        ))}
      </div>
    </div>
  );
}

function Card({ href, label, description }: { href: string; label: string; description: string }) {
  return (
    <Link href={href} className="panel block p-5 transition-transform hover:-translate-y-0.5">
      <p className="font-display text-[0.9375rem] font-medium text-paper">{label}</p>
      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-mute-2">{description}</p>
    </Link>
  );
}
