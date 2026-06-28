import { socket } from '@/lib/socket';
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

    if (this.role === 'offerer') {
      this.channel = this.pc.createDataChannel('transfer', { ordered: true });
      this.channel.binaryType = 'arraybuffer';
      this.setupChannelListeners(this.channel);
    } else {
      this.pc.ondatachannel = (event) => {
        this.channel = event.channel;
        this.channel.binaryType = 'arraybuffer';
        this.setupChannelListeners(this.channel);
      };
    }

    // Arrow function으로 this를 캡처해 인스턴스별 독립 참조 생성
    this.handleOffer = async ({ sdp }: SdpPayload) => {
      await this.pc.setRemoteDescription(sdp);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      socket.emit('answer', { sdp: answer });
    };

    this.handleAnswer = async ({ sdp }: SdpPayload) => {
      await this.pc.setRemoteDescription(sdp);
    };

    this.handleIceCandidate = async ({ candidate }: IceCandidatePayload) => {
      await this.pc.addIceCandidate(candidate);
    };

    this.handlePeerJoined = async () => {
      if (this.role !== 'offerer') return;
      await this.createAndSendOffer();
    };

    this.handlePeerReconnected = async () => {
      if (this.role !== 'offerer') return;
      await this.createAndSendOffer();
    };

    this.setupSignalingListeners();
  }

  private setupPeerConnectionListeners() {
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        socket.emit('ice-candidate', { candidate: candidate.toJSON() });
      }
    };

    this.pc.onconnectionstatechange = () => {
      this.onConnectionState(this.pc.connectionState);
    };

    this.pc.oniceconnectionstatechange = () => {
      if (
        this.pc.iceConnectionState === 'disconnected' ||
        this.pc.iceConnectionState === 'failed'
      ) {
        this.pc.restartIce();
      }
    };
  }

  private setupChannelListeners(ch: RTCDataChannel) {
    ch.onopen = () => this.onChannelOpen();
    ch.onmessage = (event) => this.onMessage(event);
    ch.onclose = () => this.onChannelClose?.('closed');
    ch.onerror = () => this.onChannelClose?.('error');
  }

  private setupSignalingListeners() {
    socket.on('offer', this.handleOffer);
    socket.on('answer', this.handleAnswer);
    socket.on('ice-candidate', this.handleIceCandidate);
    socket.on('peer-joined', this.handlePeerJoined);
    socket.on('peer-reconnected', this.handlePeerReconnected);
  }

  private async createAndSendOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    socket.emit('offer', { sdp: offer });
  }

  // ── Public API ───────────────────────────────────────────

  // offerer가 재연결할 때 peer가 이미 연결된 경우 직접 호출 (Bug 1)
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
