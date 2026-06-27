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
    socket.on('offer', async ({ sdp }: SdpPayload) => {
      await this.pc.setRemoteDescription(sdp);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      socket.emit('answer', { sdp: answer });
    });

    socket.on('answer', async ({ sdp }: SdpPayload) => {
      await this.pc.setRemoteDescription(sdp);
    });

    socket.on('ice-candidate', async ({ candidate }: IceCandidatePayload) => {
      await this.pc.addIceCandidate(candidate);
    });

    socket.on('peer-joined', async () => {
      if (this.role !== 'offerer') return;
      await this.createAndSendOffer();
    });

    socket.on('peer-reconnected', async () => {
      if (this.role !== 'offerer') return;
      await this.createAndSendOffer();
    });
  }

  private async createAndSendOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    socket.emit('offer', { sdp: offer });
  }

  // ── Public API ───────────────────────────────────────────

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
    socket.off('offer');
    socket.off('answer');
    socket.off('ice-candidate');
    socket.off('peer-joined');
    socket.off('peer-reconnected');
    this.channel?.close();
    this.pc.close();
  }
}
