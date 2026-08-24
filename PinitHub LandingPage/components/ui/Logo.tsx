import Image from 'next/image';

export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <Image
      src="/brand/pinithub-logo.png"
      alt=""
      width={72}
      height={72}
      className={`object-contain ${className}`}
      priority
    />
  );
}

export function Logo({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={`inline-flex max-w-[min(100%,14rem)] items-center gap-2 sm:gap-2.5 ${className}`}>
      <LogoMark className={compact ? 'h-8 w-8 sm:h-10 sm:w-10' : 'h-9 w-9 sm:h-10 sm:w-10'} />
      <span className="flex min-w-0 flex-col leading-none">
        <span className="font-display text-[1.05rem] font-bold tracking-[0.1em] text-paper sm:text-[1.2rem] sm:tracking-[0.12em]">
          PINITHUB
        </span>
        {!compact && (
          <span className="mt-0.5 hidden font-mono text-[0.5625rem] tracking-[0.14em] text-mute-2 uppercase min-[400px]:block sm:tracking-[0.18em]">
            Secure · Connect · Control
          </span>
        )}
      </span>
    </span>
  );
}
