export async function fetchIceServers(): Promise<RTCIceServer[]> {
  const base = (import.meta.env.VITE_SIGNALING_URL as string) || '';
  const res = await fetch(`${base}/ice-config`);
  if (!res.ok) throw new Error(`ICE config fetch failed: ${res.status}`);
  const body = (await res.json()) as { iceServers: RTCIceServer[] };
  return body.iceServers;
}
