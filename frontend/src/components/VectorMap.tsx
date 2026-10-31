import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import { LocateFixed, Minus, Plus, RotateCw } from 'lucide-react';
import { countries } from '@/lib/basemap';
import { latencyLabel, tone, type Location, type Region } from '@/types';
import { constrainVector, regionalCamera, resizeVectorView, vectorGeometry, type VectorView, type VectorBounds } from '@/lib/map-bounds';
import { StableRelayLabelLayout, relayLabelObstacles, relayLabelSize } from '@/lib/relay-label-layout';
import { relayExplanation } from '@/lib/relay-detail';
import { layoutCountryLabels } from '@/lib/country-label-layout';

// Same rectangular Mercator band as the accelerated renderer; no curved,
// letterboxed world outline, Arctic cap or Antarctica in compatibility mode.
const projection = geoMercator().scale(1000 / (2 * Math.PI)).translate([500, 500]);
const path = geoPath(projection);
const shapes = countries.features.map(feature => path(feature) ?? '');
type View = VectorView;
const home: View = { x: 0, y: 0, k: 1 };

// GPU-independent recovery renderer: still an interactive map, not a blank image.
export function VectorMap({ locations, selected, onSelect, onRetry, regionFocus, onInteract }: {
  regionFocus: Region | null;
  onInteract: () => void;
  locations: Location[]; selected: string | null; onSelect: (code: string) => void; onRetry: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const labelLayout = useRef(new StableRelayLabelLayout());
  const [moving, setMoving] = useState(false);
  const wheelEnd = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;
  const sizeRef = useRef({ width: 1000, height: 520 });
  const [size, setSize] = useState({ width: 1000, height: 520 });
  sizeRef.current = size;
  const [requestedView, setRequestedView] = useState<View>(home);
  const drag = useRef<{ id: number; x: number; y: number; view: View } | null>(null);
  const lastFocused = useRef<string | null>(null);
  const { scale, offsetX, offsetY, bounds } = vectorGeometry(size);
  const boundsRef = useRef<VectorBounds>(bounds);
  boundsRef.current = bounds;
  const view = constrainVector(requestedView, bounds);
  const lastRegion = useRef<Region | null>(null);
  useEffect(() => {
    if (!regionFocus || lastRegion.current === regionFocus || !root.current?.clientWidth) return;
    // Wait for ResizeObserver's actual dimensions before applying the focus once.
    if (Math.abs(root.current.clientWidth - size.width) > 1 || Math.abs(root.current.clientHeight - size.height) > 1) return;
    lastRegion.current = regionFocus;
    const camera = regionalCamera(regionFocus, size.width, size.height);
    const point = projection([camera.lng, camera.lat])!;
    const k = 512 * 2 ** camera.zoom / (1000 * scale);
    setView({ k, x: size.width / 2 - (point[0] * scale + offsetX) * k, y: size.height / 2 - (point[1] * scale + offsetY) * k });
  }, [regionFocus, size, scale, offsetX, offsetY]);

  function setView(next: View | ((current: View) => View)) {
    setRequestedView(previous => {
      const current = constrainVector(previous, boundsRef.current);
      return constrainVector(typeof next === 'function' ? next(current) : next, boundsRef.current);
    });
  }

  function zoom(factor: number, x = sizeRef.current.width / 2, y = sizeRef.current.height / 2) {
    onInteractRef.current();
    setMoving(true);
    clearTimeout(wheelEnd.current);
    wheelEnd.current = setTimeout(() => setMoving(false), 140);
    setView(current => {
      const k = Math.min(12, Math.max(1, current.k * factor));
      const ratio = k / current.k;
      return { k, x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio };
    });
  }
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        const next = { width: entry.contentRect.width, height: entry.contentRect.height };
        const previous = sizeRef.current;
        if (Math.abs(previous.width - next.width) < .01 && Math.abs(previous.height - next.height) < .01) return;
        setRequestedView(view => resizeVectorView(view, previous, next));
        setSize(next);
      }
    });
    observer.observe(element);
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('button, .vector-detail')) return;
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      zoom(Math.exp(-Math.max(-200, Math.min(200, event.deltaY)) * .003), event.clientX - bounds.left, event.clientY - bounds.top);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener('wheel', wheel); clearTimeout(wheelEnd.current); };
  }, []);

  const points = useMemo(() => locations.filter(loc => loc.hasCoordinates).map(loc => {
    const point = projection([loc.longitude, loc.latitude])!;
    return { loc, x: (point[0] * scale + offsetX) * view.k + view.x, y: (point[1] * scale + offsetY) * view.k + view.y };
  }), [locations, scale, offsetX, offsetY, view]);
  const obstacles = root.current ? relayLabelObstacles(root.current) : [];
  const labels = new Map(labelLayout.current.layout(points.map(point => ({ id: point.loc.code, x: point.x, y: point.y, ...relayLabelSize(point.loc.code) })), size.width, size.height, obstacles, moving).map(label => [label.id, label]));
  const countryLabels = layoutCountryLabels((lng, lat) => {
    const point = projection([lng, lat])!;
    return { x: (point[0] * scale + offsetX) * view.k + view.x, y: (point[1] * scale + offsetY) * view.k + view.y };
  }, size.width, size.height, Math.log2(1000 * scale * view.k / 512), [...obstacles, ...labels.values()]);
  const active = locations.find(loc => loc.code === selected);
  useEffect(() => {
    if (!active) { lastFocused.current = null; return; }
    if (lastFocused.current === active.code || !active.hasCoordinates) return;
    lastFocused.current = active.code;
    const point = projection([active.longitude, active.latitude])!;
    setView(current => {
      const k = Math.max(1.8, current.k);
      return { k, x: size.width / 2 - (point[0] * scale + offsetX) * k, y: size.height / 2 - (point[1] * scale + offsetY) * k };
    });
  }, [active, scale, offsetX, offsetY, size.width, size.height]);

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current || event.button !== 0 || (event.target as HTMLElement).closest('button, .vector-detail')) return;
    onInteractRef.current();
    clearTimeout(wheelEnd.current);
    setMoving(true);
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, view };
  }
  function release(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setMoving(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <div ref={root} className="vector-map" role="region" aria-label="Interactive compatibility world map" tabIndex={0} data-map-renderer="vector"
    data-world-left={bounds.left * view.k + view.x} data-world-right={bounds.right * view.k + view.x}
    data-world-top={bounds.top * view.k + view.y} data-world-bottom={bounds.bottom * view.k + view.y}
    onPointerDown={down} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={() => { drag.current = null; setMoving(false); }}
    onPointerMove={event => { const start = drag.current; if (start?.id === event.pointerId) setView({ ...start.view, x: start.view.x + event.clientX - start.x, y: start.view.y + event.clientY - start.y }); }}
    onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.5); }
      if (event.key === '-') { event.preventDefault(); zoom(1 / 1.5); }
      if (event.key === 'Home') { event.preventDefault(); onInteractRef.current(); setMoving(false); setView(home); }
      const delta = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[event.key];
      if (delta) { event.preventDefault(); onInteractRef.current(); setView(v => ({ ...v, x: v.x + delta[0], y: v.y + delta[1] })); }
    }}>
    <svg width="100%" height="100%" aria-hidden="true"><g transform={`translate(${view.x} ${view.y}) scale(${view.k}) translate(${offsetX} ${offsetY}) scale(${scale})`}>
      {shapes.map((d, index) => <path key={index} d={d} vectorEffect="non-scaling-stroke" />)}
    </g></svg>
    <div className="country-labels" aria-hidden="true">{countryLabels.map(label => <span key={label.id} className="country-label" data-country-name={label.name} style={{ left: label.left, top: label.top, width: label.width }}>{label.name}</span>)}</div>
    <svg className="relay-connectors" width="100%" height="100%" aria-hidden="true">{points.map(({ loc }) => {
      const label = labels.get(loc.code);
      return label && <g key={loc.code}><line className={`relay-connector${selected === loc.code ? ' selected' : ''}`} data-leader-code={loc.code} x1={label.anchorX} y1={label.anchorY} x2={label.endX} y2={label.endY} /><circle className={`relay-anchor ${tone(loc)}${selected === loc.code ? ' selected' : ''}`} data-anchor-code={loc.code} cx={label.anchorX} cy={label.anchorY} r={3.5} /></g>;
    })}</svg>
    {points.map(({ loc }) => {
      const label = labels.get(loc.code);
      return <button key={loc.code} className={`marker vector-marker staggered-marker ${tone(loc)}`} style={{ left: label?.left ?? 0, top: label?.top ?? 0, width: relayLabelSize(loc.code).width, display: label ? 'flex' : 'none' }} data-relay-code={loc.code} aria-label={`${loc.name}: ${latencyLabel(loc)}`} aria-pressed={selected === loc.code} title={`${loc.name} · ${latencyLabel(loc)}`} onClick={() => onSelect(loc.code)}>
        <span className="pin" /><span className="marker-label"><span className="relay-code">{loc.code.toUpperCase()}</span><span className="ping">{loc.latency !== null ? `${Math.round(loc.latency)} ms` : loc.status === 'pending' ? '…' : '—'}</span></span>
      </button>;
    })}
    {active && <div className="vector-detail relay-detail">
      <strong>{active.name}</strong><p className="detail-latency">{active.code.toUpperCase()} · {latencyLabel(active)}</p><p className="detail-endpoint">{active.endpoint ? `Responding endpoint: ${active.endpoint}` : `${active.relays.length} published IPv4 endpoints`}</p><p className="subtext">{relayExplanation(active)}</p><button className="detail-close" onClick={() => onSelect(active.code)}>Close details</button>
    </div>}
    <div className="map-controls"><button aria-label="Zoom in" onClick={() => zoom(1.5)}><Plus size={18} /></button><button aria-label="Zoom out" onClick={() => zoom(1 / 1.5)}><Minus size={18} /></button><button aria-label="Reset world view" onClick={() => { onInteractRef.current(); setMoving(false); setView(home); }}><LocateFixed size={18} /></button></div>
    <button className="map-recovery" onClick={onRetry} title="The compatibility map avoids GPU and worker issues. Retry the accelerated renderer."><RotateCw size={12} />Compatibility map · Retry GPU</button>
    <span className="vector-credit">Natural Earth · Public domain</span>
  </div>;
}
