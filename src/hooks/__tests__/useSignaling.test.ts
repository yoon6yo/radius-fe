import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSignaling } from '@/hooks/useSignaling';
import { useRoomStore } from '@/store/roomStore';
import { socket } from '@/lib/socket';
import { saveSession, getSession } from '@/lib/indexeddb';

function getRegisteredHandler(event: string): ((...args: unknown[]) => void) | undefined {
  const call = (socket.on as ReturnType<typeof vi.fn>).mock.calls
    .reverse()
    .find(([e]) => e === event);
  return call?.[1];
}

beforeEach(() => {
  (socket.on as ReturnType<typeof vi.fn>).mockClear();
  (socket.off as ReturnType<typeof vi.fn>).mockClear();
  (socket.emit as ReturnType<typeof vi.fn>).mockClear();
  useRoomStore.getState().reset();
});

describe('useSignaling — socket 재연결 시 자동 rejoin', () => {
  it('아직 방에 들어가지 않았으면(token 없음) 재연결돼도 rejoin을 보내지 않는다', () => {
    renderHook(() => useSignaling(), { wrapper: MemoryRouter });

    const onConnect = getRegisteredHandler('connect');
    expect(onConnect).toBeDefined();
    onConnect?.();

    expect(socket.emit).not.toHaveBeenCalledWith('rejoin', expect.anything(), expect.anything());
  });

  it('이미 방에 들어가 있는 상태에서 소켓이 재연결되면 자동으로 rejoin을 보낸다', () => {
    useRoomStore.getState().setRoom('123456', 'offerer', Date.now() + 1000 * 60 * 60);

    renderHook(() => useSignaling(), { wrapper: MemoryRouter });

    const onConnect = getRegisteredHandler('connect');
    onConnect?.();

    expect(socket.emit).toHaveBeenCalledWith(
      'rejoin',
      { token: '123456', role: 'offerer' },
      expect.any(Function),
    );
  });

  it('자동 rejoin 응답에서 peerConnected가 true면 phase를 peer_connected로 바꾼다', () => {
    useRoomStore.getState().setRoom('123456', 'answerer', Date.now() + 1000 * 60 * 60);
    renderHook(() => useSignaling(), { wrapper: MemoryRouter });

    const onConnect = getRegisteredHandler('connect');
    onConnect?.();

    const rejoinCall = (socket.emit as ReturnType<typeof vi.fn>).mock.calls.find(
      ([event]) => event === 'rejoin',
    );
    const callback = rejoinCall?.[2] as (result: unknown) => void;
    callback({ ok: true, role: 'answerer', peerConnected: true, expiresAt: Date.now() + 1000 });

    expect(useRoomStore.getState().phase).toBe('peer_connected');
  });
});

describe('leaveRoomSilently vs disconnectSilently — 세션 삭제 여부 차이', () => {
  it('leaveRoomSilently는 leave-room을 emit하고 세션을 지운다 (명시적 방 나가기)', async () => {
    await saveSession({ token: '111111', role: 'offerer', expiresAt: Date.now() + 100_000 });
    useRoomStore.getState().setRoom('111111', 'offerer', Date.now() + 100_000);

    const { result } = renderHook(() => useSignaling(), { wrapper: MemoryRouter });
    await act(async () => {
      await result.current.leaveRoomSilently();
    });

    expect(socket.emit).toHaveBeenCalledWith('leave-room');
    expect(await getSession('111111')).toBeNull();
  });

  it('disconnectSilently는 leave-room을 emit하지 않고 세션도 지우지 않는다 (그냥 화면 벗어남)', async () => {
    await saveSession({ token: '222222', role: 'answerer', expiresAt: Date.now() + 100_000 });
    useRoomStore.getState().setRoom('222222', 'answerer', Date.now() + 100_000);

    const { result } = renderHook(() => useSignaling(), { wrapper: MemoryRouter });
    act(() => {
      result.current.disconnectSilently();
    });

    expect(socket.emit).not.toHaveBeenCalledWith('leave-room');
    expect(socket.disconnect).toHaveBeenCalled();
    expect(await getSession('222222')).not.toBeNull();
    // 인메모리 룸 상태는 정리되지만(다음에 rejoinByToken이 새로 채움) 세션은 남아있어야 함
    expect(useRoomStore.getState().token).toBeNull();
  });
});
