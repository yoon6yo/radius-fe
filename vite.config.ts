import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const signalingTarget = process.env.VITE_SIGNALING_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/socket.io': { target: signalingTarget, ws: true, changeOrigin: true },
      '/ice-config': { target: signalingTarget, changeOrigin: true },
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react') || id.includes('react-router-dom')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/socket.io') || id.includes('node_modules/engine.io')) {
            return 'vendor-socket';
          }
          if (id.includes('node_modules/zustand')) {
            return 'vendor-state';
          }
        },
      },
    },
  },
});
