const STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REVOKED: 'bg-red-50 text-red-700 border-red-200',
  INACTIVE: 'bg-gray-100 text-gray-600 border-gray-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  TAMPERED: 'bg-red-50 text-red-700 border-red-200',
  INVESTIGATED: 'bg-blue-50 text-blue-700 border-blue-200',
  SUPER_ADMIN: 'bg-violet-50 text-violet-700 border-violet-200',
  ADMIN: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  ANALYST: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  AUDITOR: 'bg-teal-50 text-teal-700 border-teal-200',
  USER: 'bg-gray-100 text-gray-600 border-gray-200',
  HIGH: 'bg-red-50 text-red-700 border-red-200',
  LOW: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export function LightStatusBadge({ value }: { value: string }) {
  const style = STYLES[value] ?? 'bg-gray-100 text-gray-600 border-gray-200';
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium border ${style}`}>
      {value}
    </span>
  );
}
