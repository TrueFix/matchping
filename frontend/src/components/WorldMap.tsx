import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LocateFixed, Minus, Plus } from 'lucide-react';
import type { Location, Region } from '@/types';
import { latencyLabel, tone } from '@/types';
import { countries, countryPlaces } from '@/lib/basemap';
import { layoutCountryLabels } from '@/lib/country-label-layout';
import { VectorMap } from './VectorMap';
import { constrainMercator, MAP_LATITUDES, mercatorOverview, minimumMercatorZoom, regionalCamera } from '@/lib/map-bounds';
import { StableRelayLabelLayout, relayLabelObstacles, relayLabelSize } from '@/lib/relay-label-layout';
import { relayExplanation } from '@/lib/relay-detail';

maplibregl.setWorkerUrl(workerUrl);

function fitWorld(map: maplibregl.Map, duration = 0) {
  const camera = mercatorOverview(map.getContainer().clientWidth, map.getContainer().clientHeight);
  // Fill the canvas edge-to-edge; no polar regions or overview padding.
  map.setMinZoom(camera.zoom);
  map.easeTo({ center: [camera.lng, camera.lat], zoom: camera.zoom, duration });
}

// MatchPing's native MapLibre renderer with a bundled Natural Earth basemap.
// No third-party tiles, map token, geolocation permission, or external fonts.
type MapProps = {
  regionFocus: Region | null;
  onInteract: () => void;
  locations: Location[]; selected: string | null; onSelect: (code: string) => void;
};

export function WorldMap(props: MapProps) {
  const [compatibility, setCompatibility] = useState(false);
  return compatibility ? <VectorMap {...props} onRetry={() => setCompatibility(false)} /> :
    <AcceleratedMap {...props} onFallback={() => setCompatibility(true)} />;
}

function AcceleratedMap({ locations, selected, onSelect, onFallback, regionFocus, onInteract }: MapProps & { onFallback: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const leaders = useRef<SVGSVGElement>(null);
  const countryLayer = useRef<HTMLDivElement>(null);
  const countryNodes = useRef(new Map<string, HTMLSpanElement>());
  const labelLayout = useRef(new StableRelayLabelLayout());
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; button: HTMLButtonElement; label: HTMLSpanElement; line: SVGLineElement; anchor: SVGCircleElement }>());
  const popup = useRef<maplibregl.Popup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const geometry = locations.map(loc => `${loc.code}:${loc.longitude}:${loc.latitude}`).sort().join('|');
  const [ready, setReady] = useState(false);
  const lastSelected = useRef<string | null>(null);
  const worldView = useRef(true);
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (!container.current) return;
    const css = getComputedStyle(document.documentElement);
    let instance: maplibregl.Map;
    let frame = 0;
    let disposed = false;
    let recovery: ReturnType<typeof setTimeout> | undefined;
    const watchdog = setTimeout(onFallback, 5000);
    try {
      instance = new maplibregl.Map({
        container: container.current, center: [15, 18], zoom: 1.2, minZoom: -2, maxZoom: 7,
        dragRotate: false, pitchWithRotate: false, renderWorldCopies: false,
        // Constrain the viewport to the populated latitude band, filling both
        // axes without letterboxing, polar regions or horizontal world copies.
        transformConstrain: (center, zoom) => {
          const bounded = constrainMercator(center, zoom, container.current?.clientWidth ?? 0, container.current?.clientHeight ?? 0);
          return { center: new maplibregl.LngLat(bounded.lng, bounded.lat), zoom: bounded.zoom };
        },
        attributionControl: false,
        style: {
          version: 8,
          sources: { countries: { type: 'geojson', data: countries, attribution: 'Natural Earth · Public domain' } },
          layers: [
            { id: 'water', type: 'background', paint: { 'background-color': css.getPropertyValue('--map-water').trim() } },
            { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': css.getPropertyValue('--map-land').trim() } },
            { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': css.getPropertyValue('--map-boundary').trim(), 'line-width': ['interpolate', ['linear'], ['zoom'], 1, .9, 4, 1.4, 7, 1.8] } },
          ],
        },
      });
    } catch { clearTimeout(watchdog); onFallback(); return; }
    map.current = instance;
    countryNodes.current.clear();
    countryLayer.current?.replaceChildren(...countryPlaces.map(country => {
      const element = document.createElement('span');
      element.className = 'country-label'; element.textContent = country.name;
      element.dataset.countryName = country.name; element.style.display = 'none';
      countryNodes.current.set(country.id, element);
      return element;
    }));
    container.current.style.setProperty('--map-height', `${container.current.clientHeight}px`);
    instance.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');
    let loaded = false;
    instance.on('load', () => {
      loaded = true;
      clearTimeout(watchdog);
      setReady(true);
      fitWorld(instance);
    });
    instance.on('dragstart', () => { worldView.current = false; onInteractRef.current(); });
    instance.on('zoomstart', event => { if (event.originalEvent) { worldView.current = false; onInteractRef.current(); } });
    instance.on('error', event => { console.warn('Accelerated map failed; switching to compatibility renderer.', event.error); if (!disposed) onFallback(); });
    instance.on('webglcontextlost', event => {
      event.originalEvent.preventDefault();
      setReady(false);
      recovery = setTimeout(onFallback, 4000);
    });
    instance.on('webglcontextrestored', () => {
      clearTimeout(recovery);
      instance.resize();
      instance.triggerRepaint();
      setReady(true);
    });
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed || !container.current?.clientWidth || !container.current?.clientHeight) return;
        instance.stop();
        container.current.style.setProperty('--map-height', `${container.current.clientHeight}px`);
        instance.resize();
        if (loaded) {
          instance.setMinZoom(minimumMercatorZoom(instance.getContainer().clientWidth, instance.getContainer().clientHeight));
          if (worldView.current) fitWorld(instance);
        }
        instance.triggerRepaint();
      });
    });
    observer.observe(container.current);
    return () => { disposed = true; clearTimeout(watchdog); clearTimeout(recovery); cancelAnimationFrame(frame); observer.disconnect(); markers.current.forEach(m => { m.marker.remove(); m.line.remove(); m.anchor.remove(); }); markers.current.clear(); popup.current?.remove(); instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!ready || !map.current) return;
    const visible = new Set(locations.filter(loc => loc.hasCoordinates).map(loc => loc.code));
    markers.current.forEach((entry, code) => { if (!visible.has(code)) { entry.marker.remove(); entry.line.remove(); entry.anchor.remove(); markers.current.delete(code); } });
    locations.filter(loc => loc.hasCoordinates).forEach(loc => {
      let entry = markers.current.get(loc.code);
      if (!entry) {
        const button = document.createElement('button');
        button.type = 'button';
        const pin = document.createElement('span'); pin.className = 'pin';
        const label = document.createElement('span'); label.className = 'marker-label';
        button.append(pin, label);
        button.addEventListener('click', () => onSelectRef.current(loc.code));
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('class', 'relay-connector');
        line.dataset.leaderCode = loc.code;
        const anchor = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        anchor.setAttribute('r', '3.5');
        anchor.dataset.anchorCode = loc.code;
        leaders.current?.append(line, anchor);
        const marker = new maplibregl.Marker({ element: button, anchor: 'left' }).setLngLat([loc.longitude, loc.latitude]).addTo(map.current!);
        entry = { marker, button, label, line, anchor };
        markers.current.set(loc.code, entry);
      }
      // MapLibre owns positioning classes; never replace the whole className.
      entry.button.classList.remove('good', 'moderate', 'high', 'unknown');
      entry.button.classList.add('marker', 'staggered-marker', tone(loc));
      entry.button.style.setProperty('--relay-width', `${relayLabelSize(loc.code).width}px`);
      entry.anchor.setAttribute('class', `relay-anchor ${tone(loc)}${selected === loc.code ? ' selected' : ''}`);
      entry.line.setAttribute('class', `relay-connector${selected === loc.code ? ' selected' : ''}`);
      entry.button.setAttribute('aria-label', `${loc.name}: ${latencyLabel(loc)}`);
      entry.button.setAttribute('aria-pressed', String(selected === loc.code));
      entry.button.title = `${loc.name} · ${latencyLabel(loc)}`;
      entry.button.dataset.longitude = String(loc.longitude);
      entry.button.dataset.latitude = String(loc.latitude);
      entry.button.dataset.relayCode = loc.code;
      const code = document.createElement('span'); code.textContent = loc.code.toUpperCase();
      code.className = 'relay-code';
      const ping = document.createElement('span'); ping.className = 'ping';
      ping.textContent = loc.latency !== null ? `${Math.round(loc.latency)} ms` : loc.status === 'pending' ? '…' : '—';
      entry.label.replaceChildren(code, ping);
    });
    map.current.triggerRepaint();
  }, [locations, selected, ready]);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    // MapLibre 6 smart-wraps DOM markers independently of renderWorldCopies.
    // Position them from their original coordinates after the camera renders,
    // so no relay can jump to a missing copy on the other side of the world.
    function pinToSingleWorld() {
      const host = container.current;
      if (host) {
        host.dataset.worldLeft = String(instance!.project([-180, 0]).x);
        host.dataset.worldRight = String(instance!.project([180, 0]).x);
        host.dataset.worldTop = String(instance!.project([0, 85.0511287798066]).y);
        host.dataset.worldBottom = String(instance!.project([0, -85.0511287798066]).y);
        host.dataset.limitTop = String(instance!.project([0, MAP_LATITUDES.north]).y);
        host.dataset.limitBottom = String(instance!.project([0, MAP_LATITUDES.south]).y);
      }
      if (!host) return;
      const points = [...markers.current.entries()].map(([id, entry]) => {
        const point = instance!.project([Number(entry.button.dataset.longitude), Number(entry.button.dataset.latitude)]);
        return { id, x: point.x, y: point.y, ...relayLabelSize(id) };
      });
      const obstacles = relayLabelObstacles(host);
      const placements = new Map(labelLayout.current.layout(points, host.clientWidth, host.clientHeight, obstacles, instance!.isMoving()).map(label => [label.id, label]));
      const countryLabels = new Map(layoutCountryLabels((lng, lat) => instance!.project([lng, lat]), host.clientWidth, host.clientHeight,
        instance!.getZoom(), [...obstacles, ...placements.values()]).map(label => [label.id, label]));
      for (const [id, entry] of markers.current) {
        const placement = placements.get(id);
        entry.button.style.display = placement ? 'flex' : 'none';
        entry.line.style.display = placement ? '' : 'none';
        entry.anchor.style.display = placement ? '' : 'none';
        if (!placement) continue;
        entry.button.style.setProperty('--relay-left', `${placement.left}px`);
        entry.button.style.setProperty('--relay-top', `${placement.top}px`);
        entry.button.dataset.anchorX = String(placement.anchorX);
        entry.button.dataset.anchorY = String(placement.anchorY);
        entry.line.setAttribute('x1', String(placement.anchorX));
        entry.line.setAttribute('y1', String(placement.anchorY));
        entry.line.setAttribute('x2', String(placement.endX));
        entry.line.setAttribute('y2', String(placement.endY));
        entry.anchor.setAttribute('cx', String(placement.anchorX));
        entry.anchor.setAttribute('cy', String(placement.anchorY));
      }
      for (const [id, element] of countryNodes.current) {
        const label = countryLabels.get(id);
        element.style.display = label ? '' : 'none';
        if (label) { element.style.left = `${label.left}px`; element.style.top = `${label.top}px`; element.style.width = `${label.width}px`; }
      }
      const item = popup.current;
      if (item?.isOpen()) {
        const element = item.getElement();
        if (!element || element.dataset.longitude === undefined) return;
        const lng = Number(element.dataset.longitude), lat = Number(element.dataset.latitude);
        if (item.getLngLat().lng !== lng || item.getLngLat().lat !== lat) item.setLngLat([lng, lat]);
        const point = instance!.project([lng, lat]);
        element.style.visibility = point.x < 0 || point.x > instance!.getContainer().clientWidth || point.y < 0 || point.y > instance!.getContainer().clientHeight ? 'hidden' : '';
      }
    }
    pinToSingleWorld();
    instance.on('render', pinToSingleWorld);
    instance.on('moveend', pinToSingleWorld);
    return () => { instance.off('render', pinToSingleWorld); instance.off('moveend', pinToSingleWorld); };
  }, [geometry, selected, ready]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const loc = locations.find(loc => loc.code === selected);
    if (!loc || !loc.hasCoordinates) { popup.current?.remove(); lastSelected.current = null; return; }
    if (lastSelected.current !== selected) {
      popup.current?.remove();
      worldView.current = false;
      map.current.easeTo({ center: [loc.longitude, loc.latitude], zoom: Math.max(map.current.getZoom(), 2.6), offset: [0, Math.max(0, map.current.getContainer().clientHeight / 2 - 28)], duration: reduceMotion() ? 0 : 280 });
      lastSelected.current = selected;
      popup.current = new maplibregl.Popup({ offset: 18, anchor: 'bottom', closeButton: false, closeOnClick: false, maxWidth: '320px', focusAfterOpen: false }).setLngLat([loc.longitude, loc.latitude]).addTo(map.current);
    }
    const content = document.createElement('div');
    content.className = 'relay-detail';
    const title = document.createElement('strong'); title.textContent = loc.name;
    const text = document.createElement('p'); text.className = 'detail-latency'; text.textContent = `${loc.code.toUpperCase()} · ${latencyLabel(loc)}`;
    const endpoint = document.createElement('p'); endpoint.className = 'detail-endpoint'; endpoint.textContent = loc.endpoint ? `Responding endpoint: ${loc.endpoint}` : `${loc.relays.length} published IPv4 endpoints`;
    const detail = document.createElement('p'); detail.className = 'subtext'; detail.textContent = relayExplanation(loc);
    const close = document.createElement('button'); close.className = 'detail-close'; close.textContent = 'Close details'; close.addEventListener('click', () => onSelectRef.current(loc.code));
    content.append(title, text, endpoint, detail, close);
    popup.current?.setDOMContent(content);
    const element = popup.current?.getElement();
    if (element) {
      element.dataset.longitude = String(loc.longitude);
      element.dataset.latitude = String(loc.latitude);
    }
  }, [selected, locations, ready]);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || !regionFocus) return;
    worldView.current = false;
    const camera = regionalCamera(regionFocus, instance.getContainer().clientWidth, instance.getContainer().clientHeight);
    instance.easeTo({ center: [camera.lng, camera.lat], zoom: camera.zoom, duration: reduceMotion() ? 0 : 280 });
  }, [regionFocus, ready]);

  function reset() {
    const instance = map.current;
    if (!instance) return;
    onInteractRef.current();
    worldView.current = true;
    fitWorld(instance, reduceMotion() ? 0 : 350);
  }
  return <>
    <div ref={container} className="map-container" aria-label="Interactive world map of Steam relay locations" data-map-renderer="accelerated" />
    <div ref={countryLayer} className="country-labels" aria-hidden="true" />
    <svg ref={leaders} className="relay-connectors" width="100%" height="100%" aria-hidden="true" />
    {!ready && <div className="map-loading" role="status"><span className="status-dot moderate" />Preparing your world map…</div>}
    <div className="map-controls">
      <button aria-label="Zoom in" onClick={() => { onInteractRef.current(); worldView.current = false; map.current?.zoomIn({ duration: reduceMotion() ? 0 : 200 }); }}><Plus size={18} /></button>
      <button aria-label="Zoom out" onClick={() => { onInteractRef.current(); worldView.current = false; map.current?.zoomOut({ duration: reduceMotion() ? 0 : 200 }); }}><Minus size={18} /></button>
      <button aria-label="Reset world view" onClick={reset}><LocateFixed size={16} /></button>
    </div>
  </>;
}
