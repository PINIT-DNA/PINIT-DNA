import { credentialSeal, type HumanVerification } from '../../lib/credential-registry';

const TIER_COLOR = {
  gold: '#D9A441',
  silver: '#C5CDD8',
  bronze: '#C4845A',
} as const;

export function CredentialBadge({
  human,
  size = 64,
}: {
  human: HumanVerification;
  size?: number;
}) {
  const seal = credentialSeal(human);
  if (!seal.headline) return null;
  const color = seal.tier ? TIER_COLOR[seal.tier] : '#32D583';

  return (
    <div
      className="shrink-0 flex flex-col items-center justify-center text-center rounded-full border"
      style={{
        width: size,
        height: size,
        borderColor: `${color}66`,
        background: 'radial-gradient(circle at 40% 32%, #1A1F2A 0%, #0C1018 70%)',
        boxShadow: `0 6px 16px -10px ${color}`,
      }}
      aria-label={seal.percent != null ? `${seal.headline} ${seal.percent}%` : seal.headline}
    >
      <span className="w-1.5 h-1.5 rounded-full mb-0.5" style={{ background: color }} />
      <span
        className="leading-tight font-semibold uppercase"
        style={{ color, fontSize: size < 60 ? 6 : 7, letterSpacing: '0.08em', maxWidth: size - 10 }}
      >
        {seal.headline.split(' ').map((w) => (
          <span key={w} className="block">{w}</span>
        ))}
      </span>
      {seal.tier && (
        <span className="uppercase font-bold mt-0.5" style={{ color, fontSize: size < 60 ? 7 : 8, letterSpacing: '0.12em' }}>
          {seal.tier}
        </span>
      )}
    </div>
  );
}
