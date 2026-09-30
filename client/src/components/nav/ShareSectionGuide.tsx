type ShareSection = 'tracking' | 'sharing' | 'activity' | 'credentials';

const SECTIONS: Array<{ id: ShareSection; label: string; blurb: string }> = [
  { id: 'tracking', label: 'Tracking', blurb: 'Counts for each file' },
  { id: 'sharing', label: 'Sharing', blurb: 'Links you already sent' },
  { id: 'activity', label: 'Asset Activity', blurb: 'Life of the file' },
  { id: 'credentials', label: 'Credentials', blurb: 'Certificates to show' },
];

export function ShareSectionGuide({ current }: { current: ShareSection }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 dark:border-bg-border dark:bg-bg-card">
      {SECTIONS.map((s) => {
        const on = s.id === current;
        return (
          <div key={s.id} className={on ? 'min-w-0' : 'min-w-0 opacity-55'}>
            <p className={`text-[11px] font-semibold ${on ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
              {s.label}
              {on ? ' · you are here' : ''}
            </p>
            <p className="text-[11px] leading-snug text-slate-500">{s.blurb}</p>
          </div>
        );
      })}
    </div>
  );
}
