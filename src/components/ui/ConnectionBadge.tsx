import type { ConnectionStats } from '@/hooks/useConnectionStats';

interface ConnectionBadgeProps {
  stats: ConnectionStats;
  visible: boolean;
}

function formatRtt(ms: number | null): string {
  if (ms === null) return '';
  return `RTT ${Math.round(ms * 1000)}ms`;
}

function formatBw(bps: number | null): string {
  if (bps === null) return '';
  const mbps = bps / 1_000_000;
  return `${mbps.toFixed(1)} Mbps`;
}

export function ConnectionBadge({ stats, visible }: ConnectionBadgeProps) {
  if (!visible) return null;

  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {stats.isRelayed ? (
        <span className="bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded">
          중계 서버 경유 (느릴 수 있음)
        </span>
      ) : (
        <span className="bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-0.5 rounded">
          P2P 직접 연결
        </span>
      )}
      {stats.roundTripTime !== null && (
        <span className="bg-gray-800 text-gray-400 px-2 py-0.5 rounded">
          {formatRtt(stats.roundTripTime)}
        </span>
      )}
      {stats.availableBandwidthBps !== null && (
        <span className="bg-gray-800 text-gray-400 px-2 py-0.5 rounded">
          {formatBw(stats.availableBandwidthBps)}
        </span>
      )}
    </div>
  );
}
