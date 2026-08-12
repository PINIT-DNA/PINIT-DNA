export function Metric({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="font-display text-lg font-semibold text-paper">{value}</dt>
      <dd className="eyebrow mt-1.5">{label}</dd>
    </div>
  );
}
