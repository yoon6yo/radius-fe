import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from '@/pages/Home';

const Room = lazy(() => import('@/pages/Room'));

function RoomFallback() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-500 text-sm">로딩 중…</p>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="/r/:token"
        element={
          <Suspense fallback={<RoomFallback />}>
            <Room />
          </Suspense>
        }
      />
    </Routes>
  );
}
