import type { Location } from '@/types';

export function relayExplanation(loc: Location) {
  return loc.detail || {
    pending: 'Waiting for an ICMP measurement from this device.',
    measured: 'Median ICMP round-trip time. Your in-game latency may differ.',
    timeout: 'No ICMP reply. The relay may still be reachable in game.',
    unsupported: 'Measurement unavailable. Check your system ping utility and permissions.',
    'no-endpoint': 'Steam does not publish an IPv4 endpoint for this location.',
    cancelled: 'Measurement stopped before a reply was recorded.',
  }[loc.status];
}
