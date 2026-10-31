import raw from '../../public/world.geojson?raw';
import type { FeatureCollection, Geometry } from 'geojson';
import { geoContains } from 'd3-geo';

// Embed geometry in the app bundle. WebKit workers need not fetch a Wails URL,
// and both renderers have the same offline data even during startup or recovery.
const source = JSON.parse(raw) as FeatureCollection<Geometry>;
export const countries: FeatureCollection<Geometry> = {
  type: 'FeatureCollection',
  features: source.features.map(({ geometry }, index) => ({ type: 'Feature', id: index, properties: {}, geometry })),
};

// Natural Earth's cartographic label points avoid placing a country's name in
// the ocean or in an overseas territory, unlike a polygon's bounding-box center.
export const countryPlaces = source.features.flatMap((feature, id) => {
  const p = feature.properties;
  if (!p || typeof p.NAME !== 'string' || !Number.isFinite(p.LABEL_X) || !Number.isFinite(p.LABEL_Y) || p.LABEL_Y < -55 || p.LABEL_Y > 75) return [];
  const longitude = Number(p.LABEL_X), latitude = Number(p.LABEL_Y);
  const positions: [number, number][] = [[longitude, latitude]];
  // Larger countries have a few nearby, land-checked alternatives so their name
  // can avoid a relay without ever moving the relay's stable label slot.
  if (Number(p.LABELRANK) <= 3) for (const [dx, dy] of [[0, 2], [0, -2], [2, 0], [-2, 0], [0, 4], [0, -4]]) {
    const position: [number, number] = [longitude + dx, latitude + dy];
    if (geoContains(feature, position)) positions.push(position);
  }
  return [{ id: String(id), name: p.NAME === 'United States of America' ? 'United States' : p.NAME,
    longitude, latitude, positions,
    minZoom: Math.max(0, Number(p.MIN_LABEL ?? 3) - .7), rank: Number(p.LABELRANK ?? 6) }];
}).sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
