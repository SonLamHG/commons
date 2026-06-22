import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  // host: true binds 0.0.0.0 (IPv4 + IPv6) so http://localhost works regardless
  // of how the OS resolves it — Windows often prefers IPv4 (127.0.0.1).
  server: { host: true, port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
