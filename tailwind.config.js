/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/client/**/*.{ts,tsx}'],
  // The host application owns the page; a reset would restyle all of it.
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        dsw: {
          text: 'var(--dsw-alias-label-primary)',
          muted: 'var(--dsw-alias-label-secondary)',
          border: 'var(--dsw-alias-border-l1)',
          strong: 'var(--dsw-alias-border-l2)',
          surface: 'var(--dsw-alias-bg-layer-1)',
          overlay: 'var(--dsw-alias-bg-overlay)',
          primary: 'var(--dsw-alias-brand-primary)',
          success: 'var(--dsw-alias-state-success-primary)',
          warn: 'var(--dsw-alias-state-warn-primary)',
          error: 'var(--dsw-alias-state-error-primary)',
          idle: 'var(--dsw-alias-state-idle-primary)',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
