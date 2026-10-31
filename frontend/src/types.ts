export type Location = {
  code: string; name: string; longitude: number; latitude: number; hasCoordinates: boolean;
  status: 'pending' | 'measured' | 'timeout' | 'unsupported' | 'no-endpoint' | 'cancelled';
  latency: number | null; relays: { ipv4: string; port_range: number[] }[];
  endpoint?: string; detail?: string;
};
export type ScanState = {
  id: number; appId: number; running: boolean; phase: string; locations: Location[];
  completed: number; revision: number; fetchedAt: string; stale: boolean; warning: string; error: string;
};
export type BuildInfo = { version: string; repository: string; appId: number };
export type Update = { version: string; releaseUrl: string; available: boolean };
export type Region = { country: string; continent: string; latitude: number; longitude: number };

export function latencyLabel(location: Location): string {
  if (location.latency !== null) return `${Math.round(location.latency)} ms`;
  return { pending: 'Measuring…', measured: '—', timeout: 'No response', unsupported: 'Unavailable', 'no-endpoint': 'No endpoint', cancelled: 'Cancelled' }[location.status];
}
export function tone(location: Location): string {
  if (location.latency === null) return 'unknown';
  return location.latency < 60 ? 'good' : location.latency < 130 ? 'moderate' : 'high';
}
