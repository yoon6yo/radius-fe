import '@testing-library/jest-dom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

// 각 테스트마다 새로운 IndexedDB 인스턴스 사용
beforeEach(() => {
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
});

// socket 모듈 자동 모킹 (io() 호출이 테스트 환경에서 실패하지 않도록)
vi.mock('@/lib/socket', () => ({
  socket: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
  },
}));
