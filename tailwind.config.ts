import type { Config } from 'tailwindcss';

/**
 * VozLook design tokens — dark premium SaaS palette.
 * Accent: violet / electric. Neutrals: cool slate.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Surfaces — deepest to raised
        ink: {
          950: '#08080c',
          900: '#0b0b11',
          850: '#0f0f17',
          800: '#13131d',
          750: '#181824',
          700: '#1e1e2c',
          600: '#262635',
          500: '#33334a',
          400: '#454562',
        },
        // Text neutrals
        mist: {
          50: '#f6f7fb',
          100: '#eceef6',
          200: '#d9dced',
          300: '#b8bdd3',
          400: '#8d93ad',
          500: '#6b718a',
          600: '#4e5468',
        },
        // Accents
        violet: {
          50: '#f3f0ff',
          100: '#e8e2ff',
          200: '#d4c9ff',
          300: '#b7a4ff',
          400: '#9a78ff',
          500: '#7c4dff',
          600: '#6a34e8',
          700: '#5726bf',
          800: '#452097',
          900: '#2f1667',
        },
        electric: {
          300: '#7de2ff',
          400: '#38cfff',
          500: '#12b6f0',
          600: '#0a92c4',
        },
        // Semantic
        critical: '#ff4d6d',
        high: '#ff9f43',
        medium: '#ffd166',
        low: '#5cc8ff',
        none: '#8d93ad',
        positive: '#3ddc97',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(0,0,0,0.35), 0 8px 24px -12px rgba(0,0,0,0.7)',
        glow: '0 0 0 1px rgba(124,77,255,0.28), 0 12px 40px -18px rgba(124,77,255,0.55)',
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 50px -30px rgba(0,0,0,0.9)',
      },
      backdropBlur: {
        xs: '2px',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(124,77,255,0.45)' },
          '70%': { boxShadow: '0 0 0 8px rgba(124,77,255,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(124,77,255,0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s cubic-bezier(0.22,1,0.36,1) both',
        'fade-in': 'fade-in 0.3s ease-out both',
        shimmer: 'shimmer 1.6s infinite',
        'pulse-ring': 'pulse-ring 2s infinite',
        'slide-in-right': 'slide-in-right 0.28s cubic-bezier(0.22,1,0.36,1) both',
      },
      screens: {
        xs: '420px',
      },
    },
  },
  plugins: [],
};

export default config;
