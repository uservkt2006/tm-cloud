import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: '/home/vokhactam/tamvk/tm-cloud/frontend',
  base: './',
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: false,
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:18686' }
  },
  preview: {
    port: 5180,
    strictPort: false,
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:18686' }
  },
  build: { outDir: '/home/vokhactam/tamvk/tm-cloud/frontend/dist', emptyOutDir: true }
});
