import { notFound } from 'next/navigation';
import { CollectionEditor } from '@/components/admin/CollectionEditor';
import { SingletonForm } from '@/components/admin/SingletonForm';
import { listConfig, singletonConfig } from '@/lib/admin/registry';

export default async function AdminCollectionPage({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const { collection } = await params;

  const list = listConfig(collection);
  if (list) {
    const select = { id: true, order: true, ...Object.fromEntries(list.fields.map((f) => [f.key, true])) };
    const rows = await list.delegate.findMany({ orderBy: { order: 'asc' }, select });
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold text-paper">{list.label}</h1>
        <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-mute-2">{list.description}</p>
        <div className="mt-8">
          <CollectionEditor
            collectionKey={list.key}
            label={list.label}
            fields={list.fields}
            defaults={list.defaults}
            rows={rows as (Record<string, unknown> & { id: string })[]}
            titleField={list.titleField}
          />
        </div>
      </div>
    );
  }

  const singleton = singletonConfig(collection);
  if (singleton) {
    const select = Object.fromEntries(singleton.fields.map((f) => [f.key, true]));
    const row = await singleton.delegate.findUnique({ where: { id: 1 }, select });
    if (!row) notFound();
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold text-paper">{singleton.label}</h1>
        <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-mute-2">{singleton.description}</p>
        <div className="mt-8">
          <SingletonForm singletonKey={singleton.key} fields={singleton.fields} initial={row} />
        </div>
      </div>
    );
  }

  notFound();
}
