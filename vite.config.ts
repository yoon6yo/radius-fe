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
    // 프로덕션 콘솔 로그 제거는 되돌림 — 실사용 디버깅을 콘솔 로그에 크게 의존하고
    // 있어서(사용자가 프로덕션 콘솔 출력을 직접 붙여넣어 버그를 재현/진단하는 흐름)
    // 로그를 지우면 그 워크플로 자체가 막힘. 필요하면 토큰처럼 민감한 값만
    // 개별적으로 마스킹하는 방향으로 다시 논의.
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
