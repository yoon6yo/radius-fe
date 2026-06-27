import { describe, it, expect, beforeEach } from 'vitest';
import { useRoomStore } from '@/store/roomStore';

beforeEach(() => {
  useRoomStore.getState().reset();
});

describe('roomStore 초기 상태', () => {
  it('phase가 idle이다', () => {
    expect(useRoomStore.getState().phase).toBe('idle');
  });

  it('token, role, expiresAt이 null이다', () => {
    const { token, role, expiresAt } = useRoomStore.getState();
    expect(token).toBeNull();
    expect(role).toBeNull();
    expect(expiresAt).toBeNull();
  });
});

describe('setRoom', () => {
  it('token, role, expiresAt을 설정하고 phase를 waiting_peer로 전환한다', () => {
    useRoomStore.getState().setRoom('ABCD12', 'offerer', 9999999);
    const { token, role, expiresAt, phase } = useRoomStore.getState();
    expect(token).toBe('ABCD12');
    expect(role).toBe('offerer');
    expect(expiresAt).toBe(9999999);
    expect(phase).toBe('waiting_peer');
  });

  it('이전 errorMessage를 초기화한다', () => {
    useRoomStore.getState().setError('이전 오류');
    useRoomStore.getState().setRoom('T', 'answerer', 0);
    expect(useRoomStore.getState().errorMessage).toBeNull();
  });
});

describe('setPhase', () => {
  it('phase를 변경한다', () => {
    useRoomStore.getState().setPhase('peer_connected');
    expect(useRoomStore.getState().phase).toBe('peer_connected');
  });
});

describe('setError', () => {
  it('phase를 error로 전환하고 메시지를 저장한다', () => {
    useRoomStore.getState().setError('연결 실패');
    const { phase, errorMessage } = useRoomStore.getState();
    expect(phase).toBe('error');
    expect(errorMessage).toBe('연결 실패');
  });
});

describe('setIceServers', () => {
  it('iceServers 배열을 저장한다', () => {
    const servers: RTCIceServer[] = [{ urls: 'stun:stun.example.com' }];
    useRoomStore.getState().setIceServers(servers);
    expect(useRoomStore.getState().iceServers).toEqual(servers);
  });
});

describe('reset', () => {
  it('모든 상태를 초기값으로 되돌린다', () => {
    useRoomStore.getState().setRoom('X', 'offerer', 1);
    useRoomStore.getState().setError('err');
    useRoomStore.getState().reset();

    const { token, role, expiresAt, phase, errorMessage } = useRoomStore.getState();
    expect(token).toBeNull();
    expect(role).toBeNull();
    expect(expiresAt).toBeNull();
    expect(phase).toBe('idle');
    expect(errorMessage).toBeNull();
  });
});
