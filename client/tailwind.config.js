/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: '1rem',
        sm: '1.25rem',
        lg: '1.5rem',
        xl: '2rem',
      },
      screens: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        // ── Surfaces — neat monochrome ───────────────────────────────────────
        bg: {
          base:     '#F5F8FE',
          surface:  '#EEF5FF',
          card:     '#FFFFFF',
          elevated: '#F7FAFF',
          border:   '#DCE6F5',
          muted:    '#EEF5FF',
        },
        // ── Single accent — electric blue (token name stays dna-*) ───────────
        dna: {
          50:  '#EEF5FF',
          100: '#D6E6FF',
          400: '#5B9BFF',
          500: '#2878F0',
          600: '#1557C0',
          700: '#1557C0',
          900: '#10213F',
        },
        layer: {
          pending:    '#6b7280',
          processing: '#f59e0b',
          complete:   '#22c55e',
          failed:     '#ef4444',
        },
        success: { DEFAULT: '#16A36A', light: '#E7F8F0', dark: '#14532d' },
        warning: { DEFAULT: '#E99A22', light: '#FFF6E8', dark: '#78350f' },
        danger:  { DEFAULT: '#DC4545', light: '#FDECEC', dark: '#7f1d1d' },
        info:    { DEFAULT: '#2878F0', light: '#EEF5FF', dark: '#10213F' },
        purple:  { DEFAULT: '#2f7cf6', light: '#eff6ff', dark: '#1e3a8a' },
        cyan:    { DEFAULT: '#2f7cf6', light: '#eff6ff', dark: '#1e3a8a' },
        orange:  { DEFAULT: '#f59e0b', light: '#fffbeb', dark: '#78350f' },
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        label: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        editorial: ['DM Serif Display', 'Georgia', 'serif'],
        mono: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.7rem', { lineHeight: '1rem' }],
      },
      animation: {
        'pulse-slow':    'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow':     'spin 3s linear infinite',
        'fade-in':       'fadeIn 0.2s ease-out',
        'slide-in-left': 'slideInLeft 0.25s ease-out',
        'shimmer':       'shimmer 1.5s infinite',
      },
      keyframes: {
        fadeIn:      { from: { opacity: '0' }, to: { opacity: '1' } },
        slideInLeft: { from: { opacity: '0', transform: 'translateX(-12px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        shimmer:     { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      boxShadow: {
        'glow-purple': '0 0 20px rgba(47,124,246,0.28), 0 0 40px rgba(47,124,246,0.1)',
        'glow-green':  '0 0 20px rgba(34,197,94,0.22)',
        'glow-red':    '0 0 20px rgba(239,68,68,0.18)',
        // Layered ambient elevation for the premium light UI
        'elev-1': 'inset 0 1px 0 rgba(255,255,255,0.8), 0 1px 2px rgba(15,23,42,0.04)',
        'elev-2': 'inset 0 1px 0 rgba(255,255,255,0.8), 0 1px 2px rgba(15,23,42,0.04), 0 8px 20px -10px rgba(15,23,42,0.1)',
        'elev-3': 'inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 4px rgba(15,23,42,0.05), 0 16px 30px -12px rgba(15,23,42,0.18)',
        'btn-primary': 'inset 0 1px 0 rgba(255,255,255,0.3), 0 1px 2px rgba(23,58,120,0.35), 0 6px 14px -4px rgba(37,99,235,0.45)',
      },
    },
  },
  plugins: [],
};
