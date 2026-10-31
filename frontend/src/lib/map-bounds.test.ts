import { describe, expect, it } from 'vitest';
import { constrainMercator, constrainVector, MAP_LATITUDES, mercatorOverview, mercatorY, minimumMercatorZoom, regionalCamera, resizeVectorView, vectorGeometry } from './map-bounds';

function expectCovered(view: { lng: number; lat: number; zoom: number }, width: number, height: number) {
  const world = 512 * 2 ** view.zoom;
  const centerX = (view.lng + 180) / 360 * world;
  const centerY = mercatorY(view.lat) * world;
  expect(width / 2 - centerX).toBeLessThanOrEqual(.00001);
  expect(width / 2 - centerX + world).toBeGreaterThanOrEqual(width - .00001);
  expect(height / 2 - centerY + mercatorY(MAP_LATITUDES.north) * world).toBeLessThanOrEqual(.00001);
  expect(height / 2 - centerY + mercatorY(MAP_LATITUDES.south) * world).toBeGreaterThanOrEqual(height - .00001);
}

describe('world boundaries', () => {
  it('preserves the compatibility camera center and zoom when the locations dock resizes it', () => {
    const previous = { width: 1254, height: 323 }, next = { width: 892, height: 323 };
    const old = vectorGeometry(previous), current = vectorGeometry(next);
    const centerX = (73 + 180) / 360 * 1000, centerY = mercatorY(19) * 1000;
    const view = { k: 4.5, x: previous.width / 2 - (centerX * old.scale + old.offsetX) * 4.5,
      y: previous.height / 2 - (centerY * old.scale + old.offsetY) * 4.5 };
    const resized = resizeVectorView(view, previous, next);
    expect(((next.width / 2 - resized.x) / resized.k - current.offsetX) / current.scale).toBeCloseTo(centerX);
    expect(((next.height / 2 - resized.y) / resized.k - current.offsetY) / current.scale).toBeCloseTo(centerY);
    expect(current.scale * resized.k).toBeCloseTo(old.scale * view.k);
    const restored = resizeVectorView(resized, next, previous);
    expect(restored.x).toBeCloseTo(view.x);
    expect(restored.y).toBeCloseTo(view.y);
    expect(restored.k).toBeCloseTo(view.k);
  });
  it('focuses a broad region while respecting map boundaries', () => {
    for (const [width, height] of [[1000, 600], [390, 700]]) {
      for (const region of [{ longitude: 73, latitude: 19 }, { longitude: 180, latitude: 90 }, { longitude: -180, latitude: -90 }]) {
        const camera = regionalCamera(region, width, height);
        expect(camera.zoom).toBeGreaterThan(minimumMercatorZoom(width, height));
        expect(camera.zoom).toBeLessThan(5);
        expectCovered(camera, width, height);
      }
    }
  });
  it('leaves about 110 degrees visible for automatic region focus on desktop', () => {
    const camera = regionalCamera({ longitude: 73, latitude: 19 }, 1254, 666);
    expect(1254 / (512 * 2 ** camera.zoom) * 360).toBeCloseTo(110);
  });
  it('fills landscape, portrait and ultrawide viewports without any empty strips', () => {
    for (const [width, height] of [[1000, 700], [390, 700], [2400, 500]]) {
      expectCovered(mercatorOverview(width, height), width, height);
      for (const lng of [-10000, 0, 10000]) for (const lat of [-90, 0, 90]) {
        expectCovered(constrainMercator({ lng, lat }, -5, width, height), width, height);
      }
    }
  });
  it('stops each viewport edge at the world edge when zoomed in', () => {
    const west = constrainMercator({ lng: -10000, lat: 90 }, 2, 800, 600);
    const east = constrainMercator({ lng: 10000, lat: -90 }, 2, 800, 600);
    expect(west.lng).toBeCloseTo(-109.6875);
    expect(east.lng).toBeCloseTo(109.6875);
    expect(west.lat).toBeLessThan(MAP_LATITUDES.north);
    expect(east.lat).toBeGreaterThan(MAP_LATITUDES.south);
    expectCovered(west, 800, 600);
    expectCovered(east, 800, 600);
    const repeated = constrainMercator(west, 2, 800, 600);
    expect(repeated.lng).toBeCloseTo(west.lng, 10);
    expect(repeated.lat).toBeCloseTo(west.lat, 10);
  });
  it('reclamps correctly after a wider window or lower zoom', () => {
    const view = constrainMercator({ lng: 170, lat: 70 }, 3, 500, 400);
    const resized = constrainMercator(view, 0, 1000, 700);
    expect(resized.zoom).toBeCloseTo(minimumMercatorZoom(1000, 700));
    expectCovered(resized, 1000, 700);
  });
  it('uses the same limits for compatibility-map drag, wheel and keyboard positions', () => {
    const bounds = { width: 1000, height: 600, left: 100, right: 900, top: 100, bottom: 500 };
    expect(constrainVector({ x: 9999, y: -9999, k: .1 }, bounds)).toEqual({ x: -150, y: -150, k: 1.5 });
    expect(constrainVector({ x: 9999, y: 9999, k: 2 }, bounds)).toEqual({ x: -200, y: -200, k: 2 });
    expect(constrainVector({ x: -9999, y: -9999, k: 2 }, bounds)).toEqual({ x: -800, y: -400, k: 2 });
  });
});
