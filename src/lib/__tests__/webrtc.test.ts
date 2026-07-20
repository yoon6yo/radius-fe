import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PeerConnection } from '@/lib/webrtc';

// RTCDataChannel mock
class MockDataChannel {
  binaryType: string = 'blob';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  readyState: string = 'open';
  sentMessages: (string | ArrayBuffer)[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onbufferedamountlow: (() => void) | null = null;

  send(data: string | ArrayBuffer) { this.sentMessages.push(data); }
  close() { this.readyState = 'closed'; }

  triggerOpen() { this.onopen?.(); }
  triggerClose() { this.onclose?.(); }
  triggerError() { this.onerror?.(new Event('error')); }
  triggerMessage(data: string | ArrayBuffer) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

// RTCPeerConnection mock
class MockPeerConnection {
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';

  onicecandidate: ((e: { candidate: RTCIceCandidate | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((e: { channel: MockDataChannel }) => void) | null = null;

  _channel: MockDataChannel = new MockDataChannel();

  createDataChannel() { return this._channel; }
  async createOffer() { return { type: 'offer' as RTCSdpType, sdp: '' }; }
  async createAnswer() { return { type: 'answer' as RTCSdpType, sdp: '' }; }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  async addIceCandidate() {}
  restartIce = vi.fn();
  close = vi.fn();
  async getStats(): Promise<RTCStatsReport> {
    return new Map() as unknown as RTCStatsReport;
  }

  simulateConnectionState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
  simulateIceState(state: RTCIceConnectionState) {
    this.iceConnectionState = state;
    this.oniceconnectionstatechange?.();
  }
}

let mockPc: MockPeerConnection;

beforeEach(async () => {
  mockPc = new MockPeerConnection();
  vi.stubGlobal('RTCPeerConnection', function MockRTCPeerConnectionCtor() {
    return mockPc;
  });
  // 테스트 간 mock 호출 기록 초기화 (socket.emit 누적 방지)
  const { socket } = await import('@/lib/socket');
  (socket.emit as ReturnType<typeof vi.fn>).mockClear();
  (socket.on as ReturnType<typeof vi.fn>).mockClear();
});

function createConnection(role: 'offerer' | 'answerer', opts = {}) {
  const onMessage = vi.fn();
  const onConnectionState = vi.fn();
  const onChannelOpen = vi.fn();
  const onChannelClose = vi.fn();

  const pc = new PeerConnection({
    iceServers: [],
    role,
    onMessage,
    onConnectionState,
    onChannelOpen,
    onChannelClose,
    ...opts,
  });

  return { pc, onMessage, onConnectionState, onChannelOpen, onChannelClose };
}

describe('DataChannel 드롭 감지', () => {
  it('offerer: channel.onclose 발생 시 onChannelClose("closed") 호출', () => {
    const { onChannelClose } = createConnection('offerer');
    mockPc._channel.triggerOpen();
    mockPc._channel.triggerClose();
    expect(onChannelClose).toHaveBeenCalledWith('closed');
  });

  it('offerer: channel.onerror 발생 시 onChannelClose("error") 호출', () => {
    const { onChannelClose } = createConnection('offerer');
    mockPc._channel.triggerOpen();
    mockPc._channel.triggerError();
    expect(onChannelClose).toHaveBeenCalledWith('error');
  });

  it('onChannelClose가 없어도 에러가 발생하지 않는다', () => {
    const pc = new PeerConnection({
      iceServers: [],
      role: 'offerer',
      onMessage: vi.fn(),
      onConnectionState: vi.fn(),
      onChannelOpen: vi.fn(),
      // onChannelClose 없음
    });
    expect(() => {
      mockPc._channel.triggerClose();
      mockPc._channel.triggerError();
    }).not.toThrow();
    pc.destroy();
  });
});

describe('채널 열림/메시지', () => {
  it('channel open 시 onChannelOpen이 호출된다', () => {
    const { onChannelOpen } = createConnection('offerer');
    mockPc._channel.triggerOpen();
    expect(onChannelOpen).toHaveBeenCalled();
  });

  it('텍스트 메시지 수신 시 onMessage가 호출된다', () => {
    const { onMessage } = createConnection('offerer');
    mockPc._channel.triggerMessage('{"type":"READY","fileId":"f1"}');
    expect(onMessage).toHaveBeenCalled();
  });
});

describe('sendText / sendBinary', () => {
  it('채널이 열려 있을 때 sendText가 메시지를 전송한다', () => {
    const { pc } = createConnection('offerer');
    mockPc._channel.readyState = 'open';
    pc.sendText('hello');
    expect(mockPc._channel.sentMessages).toContain('hello');
  });

  it('채널이 닫혀 있으면 sendText가 아무것도 하지 않는다', () => {
    const { pc } = createConnection('offerer');
    mockPc._channel.readyState = 'closed';
    pc.sendText('silent');
    expect(mockPc._channel.sentMessages).toHaveLength(0);
  });

  it('채널이 닫혀 있으면 sendBinary가 아무것도 하지 않는다', () => {
    const { pc } = createConnection('offerer');
    mockPc._channel.readyState = 'closed';
    pc.sendBinary(new ArrayBuffer(4));
    expect(mockPc._channel.sentMessages).toHaveLength(0);
  });
});

describe('ICE 재시작', () => {
  it('iceConnectionState가 disconnected이면 restartIce를 호출한다', () => {
    createConnection('offerer');
    mockPc.simulateIceState('disconnected');
    expect(mockPc.restartIce).toHaveBeenCalled();
  });

  it('iceConnectionState가 failed이면 restartIce를 호출한다', () => {
    createConnection('offerer');
    mockPc.simulateIceState('failed');
    expect(mockPc.restartIce).toHaveBeenCalled();
  });
});

describe('reconnect', () => {
  it('offerer는 reconnect() 시 새 offer를 전송한다', async () => {
    const { socket } = await import('@/lib/socket');
    const { pc } = createConnection('offerer');
    pc.reconnect();
    // createOffer → setLocalDescription → socket.emit('offer', ...)
    await new Promise((r) => setTimeout(r, 0));
    expect(socket.emit).toHaveBeenCalledWith('offer', expect.anything());
    expect(mockPc.restartIce).toHaveBeenCalled();
  });

  it('answerer는 reconnect() 시 restartIce만 호출한다', async () => {
    const { socket } = await import('@/lib/socket');
    const { pc } = createConnection('answerer');
    pc.reconnect();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockPc.restartIce).toHaveBeenCalled();
    // answerer는 offer를 보내지 않음
    const offerCalls = (socket.emit as ReturnType<typeof vi.fn>).mock.calls
      .filter(([ev]) => ev === 'offer');
    expect(offerCalls).toHaveLength(0);
  });
});

describe('destroy', () => {
  it('destroy 후 채널과 PC가 닫힌다', () => {
    const { pc } = createConnection('offerer');
    pc.destroy();
    expect(mockPc.close).toHaveBeenCalled();
  });
});

describe('ICE 실패 진단 로그', () => {
  it('iceConnectionState가 failed면 getStats() 기반 진단 로그를 남긴다', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createConnection('offerer');
    mockPc.simulateIceState('failed');
    // logIceDiagnostics는 getStats()를 await하므로 마이크로태스크 flush 필요
    await new Promise((r) => setTimeout(r, 0));

    const diagnosticsCall = warnSpy.mock.calls.find(([msg]) =>
      typeof msg === 'string' && msg.includes('[ICE] diagnostics'),
    );
    expect(diagnosticsCall).toBeDefined();
    warnSpy.mockRestore();
  });

  it('connectionState가 failed면 getStats() 기반 진단 로그를 남긴다', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createConnection('offerer');
    mockPc.simulateConnectionState('failed');
    await new Promise((r) => setTimeout(r, 0));

    const diagnosticsCall = warnSpy.mock.calls.find(([msg]) =>
      typeof msg === 'string' && msg.includes('[ICE] diagnostics'),
    );
    expect(diagnosticsCall).toBeDefined();
    warnSpy.mockRestore();
  });
});
