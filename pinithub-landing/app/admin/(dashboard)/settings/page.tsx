import { SingletonForm } from '@/components/admin/SingletonForm';
import { SINGLETON_REGISTRY } from '@/lib/admin/registry';

export default async function AdminSettingsPage() {
  const cfg = SINGLETON_REGISTRY.siteSettings;
  const select = Object.fromEntries(cfg.fields.map((f) => [f.key, true]));
  const row = (await cfg.delegate.findUnique({ where: { id: 1 }, select })) ?? {};

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-paper">Site settings</h1>
      <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-mute-2">{cfg.description}</p>
      <div className="mt-8">
        <SingletonForm singletonKey="siteSettings" fields={cfg.fields} initial={row} />
      </div>
    </div>
  );
}
