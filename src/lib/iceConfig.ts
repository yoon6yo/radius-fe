export async function fetchIceServers(): Promise<RTCIceServer[]> {
  const url = `${import.meta.env.VITE_SIGNALING_URL as string}/ice-config`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ICE config fetch failed: ${res.status}`);
  const body = (await res.json()) as { iceServers: RTCIceServer[] };
  return body.iceServers;
}
