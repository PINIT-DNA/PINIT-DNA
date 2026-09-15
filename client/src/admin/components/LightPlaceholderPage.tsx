interface Props {
  title: string;
  description?: string;
  note?: string;
}

export function LightPlaceholderPage({ title, description, note }: Props) {
  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
      </div>
      <div className="border border-gray-200 border-dashed rounded-xl p-12 text-center bg-white">
        <p className="text-sm text-gray-500">This module is scheduled for a future release.</p>
        {note && <p className="text-xs text-gray-400 mt-2">{note}</p>}
      </div>
    </div>
  );
}
