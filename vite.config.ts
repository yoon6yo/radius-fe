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
    // 프로덕션 빌드에서 console.*/debugger를 제거한다. PIN/토큰, 파일명,
    // ICE candidate(로컬 IP 등) 같은 값이 콘솔 로그로 남아있으면 화면 공유·확장
    // 프로그램·지원 로그 등을 통해 노출될 수 있음.
    // (esbuild.drop을 쓰지 않은 이유: 이 프로젝트는 rolldown 기반 Vite라
    // esbuild 패키지가 devDependency로 없어 관련 타입이 깨져 있음 — terser는
    // 별도로 설치해 타입/런타임 모두 안정적으로 검증 가능해서 이쪽을 사용)
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
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
