import { PageHeader } from './PageHeader';

interface Props {
  title: string;
  description?: string;
}

export function PlaceholderPage({ title, description }: Props) {
  return (
    <div className="max-w-3xl">
      <PageHeader title={title} description={description} />
      <div className="border border-zinc-800 border-dashed rounded-lg p-12 text-center bg-[#111113]">
        <p className="text-sm text-zinc-400">This module is scheduled for a future release.</p>
        <p className="text-xs text-zinc-600 mt-2">Core platform data is available in related sections.</p>
      </div>
    </div>
  );
}
