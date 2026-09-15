import { SectionsEditor } from '@/components/admin/SectionsEditor';
import { prisma } from '@/lib/prisma';

export default async function AdminSectionsPage() {
  const sections = await prisma.sectionMeta.findMany({ orderBy: { order: 'asc' } });

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-paper">Sections</h1>
      <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-mute-2">
        Turn sections on or off, and edit each one&rsquo;s header. The hero and the closing call-to-action
        are always shown and are not listed here.
      </p>
      <SectionsEditor sections={sections} />
    </div>
  );
}
