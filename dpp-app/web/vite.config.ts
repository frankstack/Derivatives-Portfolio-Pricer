import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base: the same build works under /next/ and at the site root.
// In development, /api is proxied to the live site so the UI runs against real data.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: { '/api': { target: 'https://derivativespricer.com', changeOrigin: true } },
  },
});
