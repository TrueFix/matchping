import { describe, expect, it } from 'vitest';
import { latencyLabel, tone, type Location } from './types';
const loc: Location = { code: 'fra', name: 'Frankfurt', longitude: 8, latitude: 50, hasCoordinates: true, status: 'pending', latency: null, relays: [] };
describe('latency display', () => {
  it('never fabricates latency for an unmeasured location', () => {
    expect(latencyLabel(loc)).toBe('Measuring…');
    expect(latencyLabel({ ...loc, status: 'timeout' })).toBe('No response');
    expect(tone(loc)).toBe('unknown');
  });
  it('formats measured values and thresholds consistently', () => {
    expect(latencyLabel({ ...loc, latency: 12.6 })).toBe('13 ms');
    expect(tone({ ...loc, latency: 59 })).toBe('good');
    expect(tone({ ...loc, latency: 60 })).toBe('moderate');
    expect(tone({ ...loc, latency: 130 })).toBe('high');
  });
});
