import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Dna, Fingerprint, ShieldCheck } from 'lucide-react';

/**
 * PINIT DNA — app launch splash (APK only).
 * Premium animated brand screen shown for ~2.2s before the biometric login.
 */
export function AppSplash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2300);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#e8edff',
        fontFamily: "'Inter', system-ui, sans-serif",
        background:
          'radial-gradient(1100px 700px at 50% 18%, rgba(56,90,255,0.30), transparent 60%),' +
          'radial-gradient(800px 600px at 80% 100%, rgba(99,102,241,0.22), transparent 55%),' +
          'linear-gradient(180deg, #060b1f 0%, #0a1330 50%, #050814 100%)',
        overflow: 'hidden',
      }}
    >
      {/* Glow ring behind the mark */}
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
        style={{ position: 'relative', marginBottom: 26 }}
      >
        <motion.div
          animate={{ scale: [1, 1.12, 1], opacity: [0.5, 0.85, 0.5] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute',
            inset: -22,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99,102,241,0.55), transparent 70%)',
            filter: 'blur(6px)',
          }}
        />
        <div
          style={{
            position: 'relative',
            width: 104,
            height: 104,
            borderRadius: 30,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #4f6bff, #7c3aed)',
            boxShadow: '0 0 50px rgba(79,107,255,0.7), inset 0 2px 0 rgba(255,255,255,0.25)',
          }}
        >
          <motion.div
            animate={{ rotateY: [0, 180, 360] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          >
            <Dna size={54} color="#ffffff" strokeWidth={1.8} />
          </motion.div>
        </div>
      </motion.div>

      {/* Wordmark */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.6 }}
        style={{ textAlign: 'center' }}
      >
        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '0.04em', color: '#fff', lineHeight: 1 }}>
          PINIT <span style={{ color: '#8ea2ff' }}>DNA</span>
        </div>
        <div style={{ marginTop: 12, fontSize: 13.5, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#7e8bc7' }}>
          Human Origin Identity
        </div>
      </motion.div>

      {/* Trust chips */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.9, duration: 0.6 }}
        style={{ display: 'flex', gap: 18, marginTop: 40 }}
      >
        {[
          [<Fingerprint size={16} key="f" />, 'Biometric'],
          [<ShieldCheck size={16} key="s" />, 'Presence'],
          [<Dna size={16} key="d" />, 'Provenance'],
        ].map(([icon, label]) => (
          <div key={label as string} style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#9fb0e8', fontSize: 12.5, fontWeight: 500 }}>
            <span style={{ color: '#8ea2ff', display: 'flex' }}>{icon}</span>
            {label}
          </div>
        ))}
      </motion.div>

      {/* Loading bar */}
      <div style={{ position: 'absolute', bottom: 64, width: 150, height: 3, borderRadius: 99, background: 'rgba(255,255,255,0.10)', overflow: 'hidden' }}>
        <motion.div
          initial={{ x: '-100%' }}
          animate={{ x: '120%' }}
          transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}
          style={{ width: '60%', height: '100%', borderRadius: 99, background: 'linear-gradient(90deg, transparent, #6d8bff, transparent)' }}
        />
      </div>

      <div style={{ position: 'absolute', bottom: 30, fontSize: 11, letterSpacing: '0.1em', color: '#5b6699' }}>
        Global Trust Infrastructure for the AI Era
      </div>
    </div>
  );
}
