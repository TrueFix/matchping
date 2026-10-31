export type LabelRect = { left: number; top: number; width: number; height: number };
export type RelayLabelPoint = { id: string; x: number; y: number; width: number; height: number };
export type RelayLabelPlacement = LabelRect & { id: string; anchorX: number; anchorY: number; endX: number; endY: number };

export function relayLabelSize(code: string) {
  return { width: Math.min(206, Math.max(124, code.length * 8 + 96)), height: 36 };
}

const gap = 5;
const inset = 6;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function labelsOverlap(a: LabelRect, b: LabelRect, spacing = gap): boolean {
  return a.left < b.left + b.width + spacing && a.left + a.width + spacing > b.left &&
    a.top < b.top + b.height + spacing && a.top + a.height + spacing > b.top;
}

// Prefer the original position, then nearby alternating up/down slots. Only use
// another column when a dense area cannot fit vertically. Codes, not RTT, set
// ordering, so labels do not shuffle as ping results arrive.
export function layoutRelayLabels(points: RelayLabelPoint[], width: number, height: number, obstacles: LabelRect[] = [], previous: RelayLabelPlacement[] = []) {
  const placed: RelayLabelPlacement[] = [];
  const occupied: LabelRect[] = [...obstacles];
  const remembered = new Map(previous.map(label => [label.id, label]));
  // Existing labels get first choice so entering relays cannot evict them.
  for (const point of [...points].sort((a, b) => Number(remembered.has(b.id)) - Number(remembered.has(a.id)) || a.id.localeCompare(b.id))) {
    if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) continue;
    const w = Math.min(point.width, Math.max(1, width - inset * 2));
    const h = point.height;
    const candidates: (LabelRect & { distance: number })[] = [];
    const add = (left: number, top: number) => {
      left = clamp(left, inset, Math.max(inset, width - w - inset));
      top = clamp(top, inset, Math.max(inset, height - h - inset));
      const dx = left - (point.x + 12), dy = top + h / 2 - point.y;
      candidates.push({ left, top, width: w, height: h, distance: dx * dx + dy * dy });
    };
    for (const column of [0, 1, -1]) for (let row = 0; row <= 8; row++) {
      add(point.x + 12 + column * (w + 16), point.y - h / 2 - row * (h + gap));
      if (row) add(point.x + 12 + column * (w + 16), point.y - h / 2 + row * (h + gap));
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const old = remembered.get(point.id);
    const preferred = old && { left: clamp(point.x + old.left - old.anchorX, inset, Math.max(inset, width - w - inset)), top: clamp(point.y + old.top - old.anchorY, inset, Math.max(inset, height - h - inset)), width: w, height: h, distance: 0 };
    const nearest = candidates.find(rect => !occupied.some(other => labelsOverlap(rect, other)));
    const preferredDistance = preferred ? (preferred.left - point.x - 12) ** 2 + (preferred.top + h / 2 - point.y) ** 2 : Infinity;
    // Hysteresis keeps nearby slots stable, but lets very long overview leaders
    // relax once zooming reveals enough room. Never do this during a gesture.
    let chosen = preferred && !occupied.some(other => labelsOverlap(preferred, other)) &&
      (!nearest || preferredDistance <= nearest.distance + 96 ** 2) ? preferred : nearest;
    if (!chosen) {
      // Still keep separate labels at very dense/coincident locations.
      const grid: typeof candidates = [];
      for (let top = inset; top + h <= height - inset; top += h + gap) {
        for (let left = inset; left + w <= width - inset; left += w + gap) {
          grid.push({ left, top, width: w, height: h, distance: (left - point.x) ** 2 + (top + h / 2 - point.y) ** 2 });
        }
      }
      grid.sort((a, b) => a.distance - b.distance);
      chosen = grid.find(rect => !occupied.some(other => labelsOverlap(rect, other)));
    }
    // At physically impossible densities, preserve the relay rather than hide it.
    const rect = chosen ?? candidates[0];
    if (!rect) continue;
    const placement = {
      id: point.id, left: rect.left, top: rect.top, width: w, height: h,
      anchorX: point.x, anchorY: point.y,
      endX: clamp(point.x, rect.left, rect.left + w),
      endY: clamp(point.y, rect.top, rect.top + h),
    };
    placed.push(placement);
    occupied.push(placement);
  }
  const congested = placed.some((label, i) => obstacles.some(obstacle => labelsOverlap(label, obstacle)) ||
    placed.slice(i + 1).some(other => labelsOverlap(label, other)));
  if (congested && placed.length) {
    // A greedy layout can fragment a small viewport even when everything would
    // fit. Repack as a last resort rather than stacking clickable labels. This
    // runs only in the settled solver, never on a camera animation frame.
    const cellWidth = Math.max(...placed.map(label => label.width));
    const cellHeight = Math.max(...placed.map(label => label.height));
    const slots: LabelRect[] = [];
    for (let top = inset; top + cellHeight <= height - inset; top += cellHeight + gap) {
      for (let left = inset; left + cellWidth <= width - inset; left += cellWidth + gap) {
        const slot = { left, top, width: cellWidth, height: cellHeight };
        if (!obstacles.some(obstacle => labelsOverlap(slot, obstacle))) slots.push(slot);
      }
    }
    if (slots.length >= placed.length) return placed.map(label => {
      slots.sort((a, b) => (a.left - label.anchorX - 12) ** 2 + (a.top + cellHeight / 2 - label.anchorY) ** 2 -
        ((b.left - label.anchorX - 12) ** 2 + (b.top + cellHeight / 2 - label.anchorY) ** 2));
      const slot = slots.shift()!;
      return { ...label, left: slot.left, top: slot.top,
        endX: clamp(label.anchorX, slot.left, slot.left + label.width),
        endY: clamp(label.anchorY, slot.top, slot.top + label.height) };
    });
  }
  return placed;
}

// Keep screen-space offsets throughout a camera gesture. Only solve collisions
// once it settles, and prefer the previous slot rather than the nearest free one.
// Geographic anchors continue following the map on every frame.
export class StableRelayLabelLayout {
  private memory = new Map<string, RelayLabelPlacement>();
  private key = '';
  private result: RelayLabelPlacement[] = [];

  layout(points: RelayLabelPoint[], width: number, height: number, obstacles: LabelRect[], moving: boolean) {
    const key = JSON.stringify([points, width, height, obstacles, moving]);
    if (key === this.key) return this.result;
    this.key = key;
    const ids = new Set(points.map(point => point.id));
    for (const id of this.memory.keys()) if (!ids.has(id)) this.memory.delete(id);
    if (!moving) {
      this.result = layoutRelayLabels(points, width, height, obstacles, [...this.memory.values()]);
      for (const label of this.result) this.memory.set(label.id, label);
      return this.result;
    }
    const fixed: RelayLabelPlacement[] = [];
    const newcomers: RelayLabelPoint[] = [];
    for (const point of points) {
      if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) continue;
      const old = this.memory.get(point.id);
      if (!old) { newcomers.push(point); continue; }
      const w = Math.min(point.width, Math.max(1, width - inset * 2));
      const left = clamp(point.x + old.left - old.anchorX, inset, Math.max(inset, width - w - inset));
      const top = clamp(point.y + old.top - old.anchorY, inset, Math.max(inset, height - point.height - inset));
      fixed.push({ id: point.id, left, top, width: w, height: point.height, anchorX: point.x, anchorY: point.y,
        endX: clamp(point.x, left, left + w), endY: clamp(point.y, top, top + point.height) });
    }
    const added = layoutRelayLabels(newcomers, width, height, [...obstacles, ...fixed]);
    for (const label of added) this.memory.set(label.id, label);
    this.result = [...fixed, ...added];
    return this.result;
  }
}

export function relayLabelObstacles(host: HTMLElement): LabelRect[] {
  const stage = host.closest('.map-stage') ?? host;
  const bounds = host.getBoundingClientRect();
  return [...stage.querySelectorAll<HTMLElement>('.map-controls, .legend, .maplibregl-popup, .vector-detail')].filter(element => {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }).map(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left - bounds.left, top: rect.top - bounds.top, width: rect.width, height: rect.height };
  });
}
