import { useCallback, useRef, useState } from 'react';
import type { PeerConnection } from '@/lib/webrtc';

export interface ConnectionStats {
  isRelayed: boolean;
  roundTripTime: number | null;
  availableBandwidthBps: number | null;
}

export function useConnectionStats(getPeerConnection: () => PeerConnection | null) {
  const [stats, setStats] = useState<ConnectionStats>({
    isRelayed: false,
    roundTripTime: null,
    availableBandwidthBps: null,
  });
  const intervalRef = useRef<number>(0);

  const startPolling = useCallback((intervalMs = 3000) => {
    clearInterval(intervalRef.current);
    intervalRef.current = window.setInterval(async () => {
      const pc = getPeerConnection();
      if (!pc) return;

      const report = await pc.getStats();
      let relayed = false;
      let rtt: number | null = null;
      let bw: number | null = null;

      for (const r of report.values()) {
        if (r.type === 'candidate-pair') {
          const pair = r as RTCIceCandidatePairStats;
          if (pair.state === 'succeeded') {
            rtt = pair.currentRoundTripTime ?? null;
            bw = pair.availableOutgoingBitrate ?? null;

            const localCand = report.get(pair.localCandidateId);
            if (
              localCand &&
              (localCand as unknown as { candidateType: string }).candidateType === 'relay'
            ) {
              relayed = true;
            }
          }
        }
      }

      setStats({ isRelayed: relayed, roundTripTime: rtt, availableBandwidthBps: bw });
    }, intervalMs);
  }, [getPeerConnection]);

  const stopPolling = useCallback(() => {
    clearInterval(intervalRef.current);
  }, []);

  return { stats, startPolling, stopPolling };
}
