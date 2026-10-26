export default {
  content: ['./index.html', './App.tsx', './components/**/*.tsx'],
  theme: {
    extend: {
      fontFamily: { sans: ['system-ui', 'sans-serif'], mono: ['ui-monospace', 'monospace'] },
      colors: { night: { 900: '#0f172a', 950: '#020617' } },
      animation: { 'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite' },
    },
  },
};
