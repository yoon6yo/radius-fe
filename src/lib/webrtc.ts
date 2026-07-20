import { socket, clearBufferedOffer } from '@/lib/socket';
import type { SdpPayload, IceCandidatePayload } from '@/types/signaling';

export type DataChannelMessageHandler = (event: MessageEvent) => void;
export type ConnectionStateHandler = (state: RTCPeerConnectionState) => void;
export type ChannelOpenHandler = () => void;
export type ChannelCloseHandler = (reason: 'closed' | 'error') => void;

interface PeerConnectionOptions {
  iceServers: RTCIceServer[];
  role: 'offerer' | 'answerer';
  onMessage: DataChannelMessageHandler;
  onConnectionState: ConnectionStateHandler;
  onChannelOpen: ChannelOpenHandler;
  onChannelClose?: ChannelCloseHandler;
}

export class PeerConnection {
  private pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private readonly role: 'offerer' | 'answerer';
  private readonly onMessage: DataChannelMessageHandler;
  private readonly onConnectionState: ConnectionStateHandler;
  private readonly onChannelOpen: ChannelOpenHandler;
  private readonly onChannelClose?: ChannelCloseHandler;

  // handler 참조를 보관해서 destroy()에서 특정 함수만 제거 (Bug 3)
  private readonly handleOffer: (data: SdpPayload) => void;
  private readonly handleAnswer: (data: SdpPayload) => void;
  private readonly handleIceCandidate: (data: IceCandidatePayload) => void;
  private readonly handlePeerJoined: () => void;
  private readonly handlePeerReconnected: () => void;

  constructor(options: PeerConnectionOptions) {
    this.role = options.role;
    this.onMessage = options.onMessage;
    this.onConnectionState = options.onConnectionState;
    this.onChannelOpen = options.onChannelOpen;
    this.onChannelClose = options.onChannelClose;

    this.pc = new RTCPeerConnection({ iceServers: options.iceServers });
    this.setupPeerConnectionListeners();

    console.log('[WebRTC] PeerConnection created, role:', this.role);
    if (this.role === 'offerer') {
      this.channel = this.pc.createDataChannel('transfer', { ordered: true });
      this.channel.binaryType = 'arraybuffer';
      console.log('[Channel] DataChannel created by offerer');
      this.setupChannelListeners(this.channel);
    } else {
      this.pc.ondatachannel = (event) => {
        console.log('[Channel] DataChannel received by answerer, readyState:', event.channel.readyState);
        this.channel = event.channel;
        this.channel.binaryType = 'arraybuffer';
        this.setupChannelListeners(this.channel);
        if (this.channel.readyState === 'open') {
          console.log('[Channel] already open on ondatachannel, firing open manually');
          this.onChannelOpen();
        }
      };
    }

    // Arrow function으로 this를 캡처해 인스턴스별 독립 참조 생성
    this.handleOffer = async ({ sdp }: SdpPayload) => {
      clearBufferedOffer(); // 버퍼 클리어 (PeerConnection이 직접 처리하므로 replay 불필요)
      console.log('[SDP] offer received, setting remote desc');
      await this.pc.setRemoteDescription(sdp);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      console.log('[SDP] answer created + sent');
      socket.emit('answer', { sdp: answer });
    };

    this.handleAnswer = async ({ sdp }: SdpPayload) => {
      console.log('[SDP] answer received, setting remote desc');
      await this.pc.setRemoteDescription(sdp);
    };

    this.handleIceCandidate = async ({ candidate }: IceCandidatePayload) => {
      console.log('[ICE] remote candidate received:', (candidate as RTCIceCandidateInit).candidate);
      await this.pc.addIceCandidate(candidate);
    };

    this.handlePeerJoined = async () => {
      if (this.role !== 'offerer') return;
      console.log('[Signal] peer-joined → creating offer');
      await this.createAndSendOffer();
    };

    this.handlePeerReconnected = async () => {
      if (this.role !== 'offerer') return;
      console.log('[Signal] peer-reconnected → creating offer');
      await this.createAndSendOffer();
    };

    this.setupSignalingListeners();
  }

  private setupPeerConnectionListeners() {
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        // 전체 candidate 문자열(포트/priority/relay 여부의 related-address 등 포함)을 그대로 찍는다 —
        // type/protocol/address만으로는 relay candidate가 실제로 만들어졌는지, 어떤 서버에서
        // 왔는지 등을 진단할 수 없어서 문제 재현 시 로그만으로는 원인을 못 좁혔다.
        console.log('[ICE] local candidate:', candidate.candidate);
        socket.emit('ice-candidate', { candidate: candidate.toJSON() });
      } else {
        console.log('[ICE] gathering complete');
      }
    };

    this.pc.onicecandidateerror = (e) => {
      const err = e as RTCPeerConnectionIceErrorEvent;
      // url을 반드시 같이 찍는다 — 이게 있어야 STUN/TURN 여러 서버 중 정확히 어느 서버가
      // 실패했는지(예: turn:rdrop.duckdns.org:3478) 구분할 수 있다. errorCode/Text만으로는
      // "뭔가 하나 실패했다"까지만 알 수 있고 무엇이 실패했는지는 알 수 없었다.
      console.warn(
        '[ICE] candidate error:', err.errorCode, err.errorText,
        'url:', err.url, 'local:', `${err.address}:${err.port}`,
      );
    };

    this.pc.onconnectionstatechange = () => {
      console.log('[WebRTC] connection state:', this.pc.connectionState);
      this.onConnectionState(this.pc.connectionState);
      if (this.pc.connectionState === 'failed') {
        void this.logIceDiagnostics('connectionState=failed');
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log('[ICE] connection state:', this.pc.iceConnectionState);
      if (
        this.pc.iceConnectionState === 'disconnected' ||
        this.pc.iceConnectionState === 'failed'
      ) {
        console.warn('[ICE] restarting ICE');
        if (this.pc.iceConnectionState === 'failed') {
          void this.logIceDiagnostics('iceConnectionState=failed');
        }
        this.pc.restartIce();
      }
    };

    this.pc.onicegatheringstatechange = () => {
      console.log('[ICE] gathering state:', this.pc.iceGatheringState);
    };

    this.pc.onsignalingstatechange = () => {
      console.log('[SDP] signaling state:', this.pc.signalingState);
    };
  }

  private setupChannelListeners(ch: RTCDataChannel) {
    ch.onopen = () => {
      console.log('[Channel] opened, role:', this.role, 'label:', ch.label);
      this.onChannelOpen();
    };
    ch.onmessage = (event) => this.onMessage(event);
    ch.onclose = () => {
      console.warn('[Channel] closed');
      this.onChannelClose?.('closed');
    };
    ch.onerror = (e) => {
      console.error('[Channel] error:', e);
      this.onChannelClose?.('error');
    };
  }

  private setupSignalingListeners() {
    socket.on('offer', this.handleOffer);
    socket.on('answer', this.handleAnswer);
    socket.on('ice-candidate', this.handleIceCandidate);
    socket.on('peer-joined', this.handlePeerJoined);
    socket.on('peer-reconnected', this.handlePeerReconnected);
  }

  private async createAndSendOffer() {
    console.log('[SDP] creating offer');
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    console.log('[SDP] offer created + sent');
    socket.emit('offer', { sdp: offer });
  }

  // ── Public API ───────────────────────────────────────────

  replayOffer(payload: SdpPayload): void {
    console.log('[WebRTC] replaying buffered offer');
    void this.handleOffer(payload);
  }

  triggerOffer(): void {
    if (this.role !== 'offerer') return;
    void this.createAndSendOffer();
  }

  sendText(message: string) {
    if (!this.channel || this.channel.readyState !== 'open') return;
    this.channel.send(message);
  }

  sendBinary(buffer: ArrayBuffer) {
    if (!this.channel || this.channel.readyState !== 'open') return;
    this.channel.send(buffer);
  }

  get isChannelOpen(): boolean {
    return this.channel?.readyState === 'open';
  }

  get bufferedAmount(): number {
    return this.channel?.bufferedAmount ?? 0;
  }

  set bufferedAmountLowThreshold(value: number) {
    if (this.channel) this.channel.bufferedAmountLowThreshold = value;
  }

  onBufferedAmountLow(handler: () => void) {
    if (this.channel) this.channel.onbufferedamountlow = handler;
  }

  async getStats(): Promise<RTCStatsReport> {
    return this.pc.getStats();
  }

  reconnect(): void {
    this.pc.restartIce();
    if (this.role === 'offerer') {
      void this.createAndSendOffer();
    }
  }

  async isRelayed(): Promise<boolean> {
    const stats = await this.pc.getStats();
    for (const report of stats.values()) {
      if (
        report.type === 'candidate-pair' &&
        (report as RTCIceCandidatePairStats).state === 'succeeded'
      ) {
        const localId = (report as RTCIceCandidatePairStats).localCandidateId;
        const localCand = stats.get(localId) as RTCIceCandidate | undefined;
        if (localCand && (localCand as unknown as { candidateType: string }).candidateType === 'relay') {
          return true;
        }
      }
    }
    return false;
  }

  // ICE 실패 시점의 getStats() 전체를 로그로 남긴다. 상태 전환 로그(checking→failed)만으로는
  // "왜" 실패했는지(relay candidate가 애초에 안 만들어졌는지, host candidate pair가 시도조차
  // 안 됐는지, 특정 pair가 timeout인지 등)를 알 수 없어서 사후 진단이 안 됐다 — 이 덤프가
  // 있으면 로그만 보고 원인을 좁힐 수 있다.
  private async logIceDiagnostics(context: string): Promise<void> {
    try {
      const stats = await this.pc.getStats();
      const lines: string[] = [`[ICE] diagnostics (${context}):`];

      stats.forEach((report) => {
        if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
          const c = report as unknown as {
            id: string; candidateType?: string; protocol?: string; address?: string; port?: number; url?: string;
          };
          lines.push(
            `  ${report.type} id=${c.id} type=${c.candidateType} proto=${c.protocol} ` +
            `${c.address ?? '?'}:${c.port ?? '?'} url=${c.url ?? '-'}`,
          );
        }
        if (report.type === 'candidate-pair') {
          const p = report as RTCIceCandidatePairStats;
          lines.push(
            `  candidate-pair id=${p.id} state=${p.state} nominated=${p.nominated} ` +
            `local=${p.localCandidateId} remote=${p.remoteCandidateId} ` +
            `bytesSent=${p.bytesSent ?? 0} bytesReceived=${p.bytesReceived ?? 0}`,
          );
        }
      });

      if (lines.length === 1) lines.push('  (candidate/candidate-pair 리포트 없음)');
      console.warn(lines.join('\n'));
    } catch (err) {
      console.warn('[ICE] diagnostics 수집 실패:', err);
    }
  }

  destroy() {
    // 이 인스턴스가 등록한 handler만 제거 (다른 리스너 보존)
    socket.off('offer', this.handleOffer);
    socket.off('answer', this.handleAnswer);
    socket.off('ice-candidate', this.handleIceCandidate);
    socket.off('peer-joined', this.handlePeerJoined);
    socket.off('peer-reconnected', this.handlePeerReconnected);
    this.channel?.close();
    this.pc.close();
  }
}
