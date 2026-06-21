import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useTheme } from '../theme';
import { Sun, Moon } from 'lucide-react';

/**
 * Temporary themed screen for app tabs not yet redesigned. Links into the
 * existing (fully working) feature page so nothing is lost.
 */
export function Placeholder({
  title, tagline, note, to, cta,
}: { title: string; tagline: string; note: string; to: string; cta: string }) {
  const navigate = useNavigate();
  const { mode, toggle } = useTheme();
  return (
    <>
      <div className="pa-top">
        <div style={{ flex: 1 }}>
          <div className="pa-title">{title}</div>
          <div className="pa-sub">{tagline}</div>
        </div>
        <button className="pa-icon-btn" onClick={toggle}>{mode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
      </div>
      <div className="pa-card" style={{ padding: 22, textAlign: 'center', marginTop: 8 }}>
        <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 16 }}>{note}</p>
        <button
          onClick={() => navigate(to)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 18px',
            borderRadius: 14, border: 0, fontWeight: 700, fontSize: 14, color: '#fff',
            background: 'linear-gradient(135deg, var(--primary), var(--primary-2))',
          }}
        >
          {cta} <ArrowRight size={16} />
        </button>
      </div>
    </>
  );
}
