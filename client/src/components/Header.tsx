export function Header() {
  return (
    <header className="w-full border-b border-bg-border bg-bg-surface/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
        <span className="text-2xl dna-float select-none">🧬</span>
        <div>
          <h1 className="font-bold text-lg leading-none tracking-tight text-white">
            PINIT<span className="text-dna-500">-DNA</span>
          </h1>
          <p className="text-xs text-gray-500 mono mt-0.5">
            Universal File DNA System v2.0.0
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-layer-complete animate-pulse-slow" />
          <span className="text-xs text-gray-400 mono">API ONLINE</span>
        </div>
      </div>
    </header>
  );
}
