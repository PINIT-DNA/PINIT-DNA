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
          base:     '#eef2f7',
          surface:  '#e2e8f0',
          card:     '#ffffff',
          elevated: '#f1f5f9',
          border:   '#cbd5e1',
          muted:    '#e2e8f0',
        },
        // ── Single accent — electric blue (token name stays dna-*) ───────────
        dna: {
          50:  '#eff6ff',
          100: '#dbeafe',
          400: '#60a5fa',
          500: '#2f7cf6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
        layer: {
          pending:    '#6b7280',
          processing: '#f59e0b',
          complete:   '#22c55e',
          failed:     '#ef4444',
        },
        success: { DEFAULT: '#22c55e', light: '#dcfce7', dark: '#14532d' },
        warning: { DEFAULT: '#f59e0b', light: '#fef3c7', dark: '#78350f' },
        danger:  { DEFAULT: '#ef4444', light: '#fee2e2', dark: '#7f1d1d' },
        info:    { DEFAULT: '#2f7cf6', light: '#dbeafe', dark: '#1e3a8a' },
        purple:  { DEFAULT: '#2f7cf6', light: '#eff6ff', dark: '#1e3a8a' },
        cyan:    { DEFAULT: '#2f7cf6', light: '#eff6ff', dark: '#1e3a8a' },
        orange:  { DEFAULT: '#f59e0b', light: '#fffbeb', dark: '#78350f' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
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
      },
    },
  },
  plugins: [],
};
