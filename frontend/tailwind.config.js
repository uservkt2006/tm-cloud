/** @type {import('tailwindcss').Config} */
export default {
  content: [
    '/home/vokhactam/tamvk/tm-cloud/frontend/index.html',
    '/home/vokhactam/tamvk/tm-cloud/frontend/src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: { accent: '#4c8dff', bg: '#0c0e12', panel: '#11141a', line: '#1f2530' },
      fontFamily: { mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'] },
    },
  },
  plugins: [],
};