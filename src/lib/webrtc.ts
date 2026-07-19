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
      console.log('[ICE] remote candidate received:', (candidate as RTCIceCandidateInit).candidate?.split(' ')[7]);
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
        console.log('[ICE] local candidate:', candidate.type, candidate.protocol, candidate.address ?? '(hidden)');
        socket.emit('ice-candidate', { candidate: candidate.toJSON() });
      } else {
        console.log('[ICE] gathering complete');
      }
    };

    this.pc.onicecandidateerror = (e) => {
      console.warn('[ICE] candidate error:', (e as RTCPeerConnectionIceErrorEvent).errorCode, (e as RTCPeerConnectionIceErrorEvent).errorText);
    };

    this.pc.onconnectionstatechange = () => {
      console.log('[WebRTC] connection state:', this.pc.connectionState);
      this.onConnectionState(this.pc.connectionState);
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log('[ICE] connection state:', this.pc.iceConnectionState);
      if (
        this.pc.iceConnectionState === 'disconnected' ||
        this.pc.iceConnectionState === 'failed'
      ) {
        console.warn('[ICE] restarting ICE');
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
