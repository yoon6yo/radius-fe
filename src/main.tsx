import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.tsx';
import { installConsoleCapture } from '@/lib/debugLog';

// 렌더링 이전, 최대한 이른 시점에 설치 — 이후 모든 console.* 호출을 캡처하기 위함
installConsoleCapture();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
