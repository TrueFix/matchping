export const MAX_MERCATOR_LATITUDE = 85.0511287798066;
export const MAP_LATITUDES = { north: 75, south: -55 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function mercatorY(latitude: number): number {
  const lat = clamp(latitude, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  return (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2;
}

export function latitudeFromMercatorY(y: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
}

export function minimumMercatorZoom(width: number, height: number): number {
  const bandHeight = mercatorY(MAP_LATITUDES.south) - mercatorY(MAP_LATITUDES.north);
  // Cover, not contain: the geographic band must fill BOTH viewport axes.
  return Math.log2(Math.max(Math.max(1, width) / 512, Math.max(1, height) / (512 * bandHeight)));
}

export function mercatorOverview(width: number, height: number) {
  return {
    lng: 0,
    lat: latitudeFromMercatorY((mercatorY(MAP_LATITUDES.north) + mercatorY(MAP_LATITUDES.south)) / 2),
    zoom: minimumMercatorZoom(width, height),
  };
}

// Roughly 110 degrees across: include neighboring countries, not a tight crop.
export function regionalCamera(region: { longitude: number; latitude: number }, width: number, height: number) {
  return constrainMercator({ lng: region.longitude, lat: region.latitude },
    Math.min(7, Math.max(minimumMercatorZoom(width, height) + .65, Math.log2(Math.max(1, width) / (512 * 110 / 360)))), width, height);
}

// Used after cover scaling, so an edge stops at the viewport instead of
// exposing another world copy or a letterboxed strip of empty canvas.
export function constrainAxis(center: number, extent: number, viewport: number): number {
  if (extent <= viewport) return extent / 2;
  return clamp(center, viewport / 2, extent - viewport / 2);
}

export function constrainMercator(center: { lng: number; lat: number }, zoom: number, width: number, height: number) {
  zoom = Math.max(zoom, minimumMercatorZoom(width, height));
  const world = 512 * 2 ** zoom;
  const x = (center.lng + 180) / 360 * world;
  const y = mercatorY(center.lat) * world;
  const north = mercatorY(MAP_LATITUDES.north) * world;
  const south = mercatorY(MAP_LATITUDES.south) * world;
  const boundedX = constrainAxis(x, world, Math.max(0, width));
  const boundedY = north + constrainAxis(y - north, south - north, Math.max(0, height));
  return {
    lng: boundedX / world * 360 - 180,
    lat: latitudeFromMercatorY(boundedY / world),
    zoom,
  };
}

export type VectorView = { x: number; y: number; k: number };
export type VectorBounds = { width: number; height: number; left: number; top: number; right: number; bottom: number };

export function vectorGeometry(size: { width: number; height: number }) {
  const north = mercatorY(MAP_LATITUDES.north) * 1000;
  const south = mercatorY(MAP_LATITUDES.south) * 1000;
  const scale = Math.max(size.width / 1000, size.height / (south - north));
  const offsetX = (size.width - 1000 * scale) / 2;
  const offsetY = size.height / 2 - (north + south) / 2 * scale;
  return { scale, offsetX, offsetY, bounds: { ...size, left: offsetX, top: offsetY + north * scale, right: offsetX + 1000 * scale, bottom: offsetY + south * scale } };
}

export function resizeVectorView(view: VectorView, previous: { width: number; height: number }, next: { width: number; height: number }) {
  const old = vectorGeometry(previous), current = vectorGeometry(next);
  view = constrainVector(view, old.bounds);
  if (view.k <= 1.000001) return constrainVector({ x: 0, y: 0, k: 1 }, current.bounds);
  const centerX = ((previous.width / 2 - view.x) / view.k - old.offsetX) / old.scale;
  const centerY = ((previous.height / 2 - view.y) / view.k - old.offsetY) / old.scale;
  const k = view.k * old.scale / current.scale;
  return constrainVector({ k, x: next.width / 2 - (centerX * current.scale + current.offsetX) * k,
    y: next.height / 2 - (centerY * current.scale + current.offsetY) * k }, current.bounds);
}

export function constrainVector(view: VectorView, bounds: VectorBounds): VectorView {
  const minimum = Math.max(1, bounds.width / (bounds.right - bounds.left), bounds.height / (bounds.bottom - bounds.top));
  const k = clamp(view.k, minimum, Math.max(12, minimum));
  function translation(value: number, start: number, end: number, viewport: number) {
    if ((end - start) * k <= viewport) return viewport / 2 - (start + end) / 2 * k;
    return clamp(value, viewport - end * k, -start * k);
  }
  return {
    k,
    x: translation(view.x, bounds.left, bounds.right, bounds.width),
    y: translation(view.y, bounds.top, bounds.bottom, bounds.height),
  };
}
