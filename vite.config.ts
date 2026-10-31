import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so the same build works at a domain root (Netlify,
  // Vercel) and under a sub-path (GitHub Pages: /<repo>/).
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
});
