import { describe, expect, it } from 'vitest';
import { labelsOverlap, layoutRelayLabels, relayLabelSize, StableRelayLabelLayout } from './relay-label-layout';

const point = (id: string, x = 300, y = 240) => ({ id, x, y, ...relayLabelSize(id) });

describe('individual relay label placement', () => {
  it('keeps relative slots fixed throughout camera movement and settles without overlaps', () => {
    const layout = new StableRelayLabelLayout();
    const points = [point('a'), point('b'), point('c')];
    const initial = layout.layout(points, 1000, 800, [], false);
    for (const delta of [1, 4, 12, 30, 0]) {
      const moved = points.map(p => ({ ...p, x: p.x + delta, y: p.y + delta / 2 }));
      const frame = layout.layout(moved, 1000, 800, [], true);
      frame.forEach(label => {
        const old = initial.find(item => item.id === label.id)!;
        expect(label.left - label.anchorX).toBeCloseTo(old.left - old.anchorX);
        expect(label.top - label.anchorY).toBeCloseTo(old.top - old.anchorY);
      });
    }
    expect(layout.layout(points, 1000, 800, [], false)).toEqual(initial);
  });
  it('does not reshuffle existing labels when another relay appears or ping ordering changes', () => {
    const layout = new StableRelayLabelLayout();
    const initial = layout.layout([point('b'), point('c')], 1000, 800, [], false);
    const changed = layout.layout([point('c'), point('a'), point('b')], 1000, 800, [], false);
    initial.forEach(label => expect(changed.find(item => item.id === label.id)).toEqual(label));
    changed.forEach((label, i) => changed.slice(i + 1).forEach(other => expect(labelsOverlap(label, other)).toBe(false)));
  });
  it('staggers coincident locations above and below their shared real location', () => {
    const labels = layoutRelayLabels([point('a'), point('b'), point('c')], 800, 600);
    expect(labels).toHaveLength(3);
    expect(labels[1].top).toBeLessThan(labels[0].top);
    expect(labels[2].top).toBeGreaterThan(labels[0].top);
    for (let i = 0; i < labels.length; i++) {
      expect(labels[i].anchorX).toBe(300);
      expect(labels[i].anchorY).toBe(240);
      for (let j = i + 1; j < labels.length; j++) expect(labelsOverlap(labels[i], labels[j])).toBe(false);
    }
  });
  it('keeps dense labels inside the map and away from controls', () => {
    const obstacle = { left: 550, top: 450, width: 240, height: 100 };
    const labels = layoutRelayLabels(Array.from({ length: 20 }, (_, i) => point(`relay${i}`, 650, 400)), 800, 600, [obstacle]);
    expect(labels).toHaveLength(20);
    labels.forEach((label, i) => {
      expect(label.left).toBeGreaterThanOrEqual(0);
      expect(label.top).toBeGreaterThanOrEqual(0);
      expect(label.left + label.width).toBeLessThanOrEqual(800);
      expect(label.top + label.height).toBeLessThanOrEqual(600);
      expect(labelsOverlap(label, obstacle)).toBe(false);
      labels.slice(i + 1).forEach(other => expect(labelsOverlap(label, other)).toBe(false));
    });
  });
  it('keeps compact-window labels clear of the legend and zoom controls', () => {
    const obstacles = [{ left: 344, top: 12, width: 44, height: 110 }, { left: 12, top: 94, width: 368, height: 60 }];
    const labels = layoutRelayLabels([point('dxb', 50, 20), point('bom2', 200, 80), point('maa2', 280, 120)], 394, 172, obstacles);
    expect(labels).toHaveLength(3);
    labels.forEach((label, i) => {
      obstacles.forEach(obstacle => expect(labelsOverlap(label, obstacle)).toBe(false));
      labels.slice(i + 1).forEach(other => expect(labelsOverlap(label, other)).toBe(false));
    });
  });
  it('is stable regardless of latency sorting and never pulls offscreen relays into view', () => {
    const points = [point('a'), point('b'), point('c'), point('outside', -20, 200)];
    expect(layoutRelayLabels(points, 800, 600)).toEqual(layoutRelayLabels([...points].reverse(), 800, 600));
    expect(layoutRelayLabels(points, 800, 600).map(label => label.id)).toEqual(['a', 'b', 'c']);
  });
});
