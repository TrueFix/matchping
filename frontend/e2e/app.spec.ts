import { expect, test, type Page } from '@playwright/test';

async function openRegionSettings(page: Page) {
  if (!await page.locator('.region-settings').evaluate(element => (element as HTMLDetailsElement).open)) {
    await page.getByLabel('Region settings', { exact: true }).click();
  }
}

test.beforeEach(async ({ page }) => {
  // Ordinary tests retain overview mode. Startup-location tests explicitly enable
  // it and intercept the backend route: CI must never disclose its IP to a provider.
  await page.addInitScript(() => {
    if (localStorage.getItem('matchping.auto-region') === null) localStorage.setItem('matchping.auto-region', 'false');
  });
  await page.route('**/api/region', route => route.fulfill({ status: 502, body: 'Fixture lookup unavailable' }));
});

test('real backend loads Steam relays, filters, and validates App IDs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'MatchPing', exact: true })).toBeVisible();
  await expect(page.locator('#relay-panel')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show locations', exact: true }).click();
  await expect(page.getByText(/\d+ worldwide/)).not.toHaveText('0 worldwide', { timeout: 30000 });
  await expect(page.locator('.marker.maplibregl-marker').first()).toHaveCSS('position', 'absolute');
  await page.getByRole('textbox', { name: 'Search locations' }).fill('Frankfurt');
  await expect(page.getByRole('button', { name: /Frankfurt Germany FRA/ })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search locations' }).fill('no-such-relay');
  await expect(page.getByText('No locations match these filters.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search locations' }).fill('');
  await page.getByLabel('App ID', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Load app' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter an App ID');
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await expect(page.getByLabel('Application updates')).toContainText('Updates are not configured');
});

test('locations dock never covers the map and collapses back to full width', async ({ page }) => {
  await page.goto('/');
  const stage = page.locator('.map-stage');
  const full = await stage.boundingBox();
  await page.getByRole('button', { name: 'Show locations', exact: true }).click();
  const dock = await page.locator('#relay-panel').boundingBox();
  const reduced = await stage.boundingBox();
  expect(dock).not.toBeNull();
  expect(reduced!.x).toBeGreaterThanOrEqual(dock!.x + dock!.width);
  expect(reduced!.width).toBeLessThan(full!.width);
  await expect(page.locator('.marker.maplibregl-marker').first()).toHaveCSS('position', 'absolute');
  // Edge-to-edge cover mode may crop faraway regions; the dock itself never
  // overlays any part of the canvas. Panning reaches those regions instead.
  await page.getByRole('button', { name: 'Hide locations', exact: true }).click();
  await expect(page.locator('#relay-panel')).toHaveCount(0);
  expect((await stage.boundingBox())!.width).toBe(full!.width);
  const toolbar = await page.locator('.map-toolbar').boundingBox();
  const area = await page.locator('.atlas-area').boundingBox();
  const canvas = await stage.boundingBox();
  expect(toolbar!.y + toolbar!.height).toBeLessThanOrEqual(canvas!.y + 1);
  expect(canvas!.y).toBeLessThan(120);
  expect(canvas!.height).toBeGreaterThan(page.viewportSize()!.height * .75);
  expect(canvas!.x).toBeCloseTo(area!.x + 1, 0);
  expect(canvas!.width).toBeCloseTo(area!.width - 2, 0);
});

test('mobile layout and help remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'About relay measurements' }).click();
  await expect(page.getByLabel('About MatchPing')).toContainText(/read-only/i);
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('About MatchPing')).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('automatic region preference survives reload and manual recenter still works when off', async ({ page }) => {
  let lookups = 0;
  await page.route('**/api/region', route => {
    lookups++;
    return route.fulfill({ json: { country: 'India', continent: 'Asia', latitude: 19, longitude: 73 } });
  });
  await page.goto('/');
  await openRegionSettings(page);
  const automatic = page.getByRole('checkbox', { name: 'Auto region on startup' });
  await expect(automatic).not.toBeChecked();
  expect(lookups).toBe(0);
  await automatic.check();
  await expect(page.getByRole('status').filter({ hasText: 'India · Asia' })).toBeVisible();
  expect(lookups).toBe(1);
  await automatic.uncheck();
  await page.reload();
  await openRegionSettings(page);
  await expect(automatic).not.toBeChecked();
  await expect(page.getByRole('status').filter({ hasText: 'World view' })).toBeVisible();
  expect(lookups).toBe(1);
  await page.getByRole('button', { name: 'Find my region', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'India · Asia' })).toBeVisible();
  expect(lookups).toBe(2);
  await expect(automatic).not.toBeChecked();
});

test('minimum desktop window retains a usable map and scrollable location list', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 600 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Show locations', exact: true }).click();
  const map = page.locator('.map-stage');
  await expect.poll(async () => (await map.boundingBox())!.height).toBeGreaterThan(400);
  await expect.poll(async () => (await page.locator('.relay-list').boundingBox())!.height).toBeGreaterThan(80);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('map recovers without WebGL and remains interactive', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof original>) {
      if (String(args[0]).startsWith('webgl')) return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.route('**/world.geojson', route => route.abort());
  await page.goto('/');
  const map = page.getByRole('region', { name: 'Interactive compatibility world map' });
  await expect(map).toBeVisible();
  await expect(map.locator('svg > g > path')).toHaveCount(177);
  const transform = await map.locator('svg > g').getAttribute('transform');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(map.locator('svg > g')).not.toHaveAttribute('transform', transform!);
  await page.getByRole('button', { name: 'Reset world view', exact: true }).click();
  await expect(map.locator('svg > g')).toHaveAttribute('transform', transform!);
  // Exercise dragging at a closer zoom as well as the edge-to-edge overview.
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const zoomedTransform = await map.locator('svg > g').getAttribute('transform');
  const box = await map.boundingBox();
  await page.mouse.move(box!.x + 50, box!.y + 60);
  await page.mouse.down();
  await page.mouse.move(box!.x + 90, box!.y + 90, { steps: 5 });
  await page.mouse.up();
  await expect(map.locator('svg > g')).not.toHaveAttribute('transform', zoomedTransform!);
  await expect(page.getByRole('button', { name: /Compatibility map/ })).toBeVisible();
});

test('failed map worker startup falls back instead of staying blank', async ({ page }) => {
  await page.route('**/maplibre-gl-worker-*.js', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Interactive compatibility world map' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Preparing your world map…')).not.toBeVisible();
});

test('loss of the GPU context recovers to an interactive map', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.marker.maplibregl-marker').first()).toHaveCSS('position', 'absolute');
  const lost = await page.locator('canvas.maplibregl-canvas').evaluate(canvas => {
    const context = (canvas as HTMLCanvasElement).getContext('webgl2');
    const extension = context?.getExtension('WEBGL_lose_context');
    extension?.loseContext();
    return Boolean(extension);
  });
  expect(lost).toBe(true);
  await expect(page.getByRole('region', { name: 'Interactive compatibility world map' })).toBeVisible({ timeout: 8000 });
});

for (const renderer of ['accelerated', 'vector']) {
  test(`${renderer} automatically locates on startup, resets and reports lookup errors`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('matchping.auto-region', 'true'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (renderer === 'vector') await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof original>) {
        if (String(args[0]).startsWith('webgl')) return null;
        return original.apply(this, args);
      } as typeof original;
    });
    let lookups = 0;
    await page.route('**/api/region', async route => {
      expect(route.request().method()).toBe('POST');
      lookups++;
      if (lookups === 3) await route.fulfill({ status: 502, body: 'ipwho.is is unavailable. Please try again later' });
      else await route.fulfill({ json: { country: 'India', continent: 'Asia', latitude: 19, longitude: 73 } });
    });
    // All location responses are fixtures; this test never contacts a geo provider.
    await page.goto('/');
    const map = page.locator(`[data-map-renderer="${renderer}"]`);
    await expect(map).toBeVisible();
    await expect(page.getByText('Preparing your world map…')).not.toBeVisible();
    await expect.poll(() => map.getAttribute('data-world-left')).not.toBeNull();
    await expect(page.getByRole('status').filter({ hasText: 'India · Asia' })).toBeVisible();
    expect(lookups).toBe(1);
    await expect(page.locator('#region-notice')).toContainText('ipwho.is');
    const span = async () => Number(await map.getAttribute('data-world-right')) - Number(await map.getAttribute('data-world-left'));
    // Wait for the regional camera to be applied, not just the provider result.
    await expect.poll(span).toBeGreaterThan((await map.boundingBox())!.width * 3);
    await expect(page.locator('[data-country-name="India"]')).toBeVisible();
    await expect(page.locator('.country-labels')).toHaveCSS('pointer-events', 'none');
    const regionalSpan = await span();
    const centerLongitude = () => map.evaluate(host => {
      const left = Number((host as HTMLElement).dataset.worldLeft), right = Number((host as HTMLElement).dataset.worldRight);
      return (host.clientWidth / 2 - left) / (right - left) * 360 - 180;
    });
    await page.getByRole('button', { name: 'Show locations', exact: true }).click();
    await expect.poll(centerLongitude).toBeCloseTo(73, 0);
    await page.getByRole('button', { name: 'Hide locations', exact: true }).click();
    await expect.poll(centerLongitude).toBeCloseTo(73, 0);
    await page.getByRole('button', { name: 'Reset world view', exact: true }).click();
    await expect.poll(span).toBeLessThan(regionalSpan / 1.8);
    // A scan/state refresh must not reapply the previous focus after reset.
    await openRegionSettings(page);
    await page.getByRole('button', { name: 'Find my region', exact: true }).click();
    await expect.poll(span).toBeCloseTo(regionalSpan, 0);
    await page.getByRole('button', { name: 'Find my region', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('ipwho.is is unavailable');
    expect(lookups).toBe(3);
    await expect(page.getByRole('button', { name: 'Find my region', exact: true })).toBeEnabled();
  });

  test(`${renderer} a slow startup lookup never overrides user navigation`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('matchping.auto-region', 'true'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (renderer === 'vector') await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof original>) {
        if (String(args[0]).startsWith('webgl')) return null;
        return original.apply(this, args);
      } as typeof original;
    });
    let finish!: () => void;
    const held = new Promise<void>(resolve => { finish = resolve; });
    await page.route('**/api/region', async route => {
      await held;
      await route.fulfill({ json: { country: 'India', continent: 'Asia', latitude: 19, longitude: 73 } });
    });
    await page.goto('/');
    const map = page.locator(`[data-map-renderer="${renderer}"]`);
    await expect(map).toHaveAttribute('data-world-left', /[-\d.]+/);
    await page.getByRole('button', { name: 'Reset world view', exact: true }).click();
    const before = await map.getAttribute('data-world-left');
    finish();
    await expect(page.getByRole('status').filter({ hasText: 'India · Asia' })).toBeVisible();
    await expect(map).toHaveAttribute('data-world-left', before!);
  });

  test(`${renderer} shows separate pings for colocated relays instead of a location count`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (renderer === 'vector') await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof original>) {
        if (String(args[0]).startsWith('webgl')) return null;
        return original.apply(this, args);
      } as typeof original;
    });
    // Fixture only: all three points share coordinates to trigger the old grouping.
    const locations = ['first', 'second', 'third'].map((code, index) => ({
      code, name: `Fixture relay ${index + 1}`, longitude: 10, latitude: 30, hasCoordinates: true,
      status: 'measured', latency: 23 + index * 5, relays: [],
    }));
    await page.route('**/api/info', route => route.fulfill({ json: { version: 'test', repository: '', appId: 730 } }));
    await page.route('**/api/scan', route => route.fulfill({ json: 1 }));
    await page.route('**/api/state', route => route.fulfill({ json: {
      id: 1, appId: 730, running: false, phase: 'done', locations, completed: 3, revision: 1,
      fetchedAt: '2026-01-01T00:00:00Z', stale: false, warning: '', error: '',
    } }));
    await page.goto('/');
    await expect(page.locator('[data-relay-code]')).toHaveCount(3);
    await expect(page.locator('.cluster-marker')).toHaveCount(0);
    async function overlappingLabels() {
      return page.locator('[data-relay-code]').evaluateAll(elements => {
        const rects = elements.map(element => element.getBoundingClientRect());
        return rects.some((a, i) => rects.slice(i + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
      });
    }
    await expect.poll(overlappingLabels).toBe(false);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const recording = page.evaluate(async () => {
      const samples: { code: string; dx: number; dy: number }[] = [];
      for (let frame = 0; frame < 30; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        for (const marker of document.querySelectorAll<HTMLElement>('[data-relay-code]')) {
          if (getComputedStyle(marker).display === 'none') continue;
          const anchor = document.querySelector(`[data-anchor-code="${marker.dataset.relayCode}"]`);
          if (!anchor) continue;
          const rect = marker.getBoundingClientRect(), pin = anchor.getBoundingClientRect();
          samples.push({ code: marker.dataset.relayCode!, dx: rect.left - pin.left - pin.width / 2, dy: rect.top - pin.top - pin.height / 2 });
        }
      }
      return samples;
    });
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    const frames = await recording;
    for (const loc of locations) {
      const samples = frames.filter(frame => frame.code === loc.code);
      expect(samples.length).toBeGreaterThan(5);
      expect(Math.max(...samples.map(frame => frame.dx)) - Math.min(...samples.map(frame => frame.dx))).toBeLessThan(1.5);
      expect(Math.max(...samples.map(frame => frame.dy)) - Math.min(...samples.map(frame => frame.dy))).toBeLessThan(1.5);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Reset world view', exact: true }).click();
    for (const location of locations) {
      const marker = page.locator(`[data-relay-code="${location.code}"]`);
      await expect(marker.locator('.ping')).toHaveText(`${location.latency} ms`);
      await expect(marker).toHaveCSS('display', 'flex');
      await marker.focus();
      await expect(marker).toBeFocused();
      await marker.click();
      await expect(page.locator(renderer === 'accelerated' ? '.maplibregl-popup-content' : '.vector-detail')).toContainText(location.name);
      const detail = await page.locator(renderer === 'accelerated' ? '.maplibregl-popup-content' : '.vector-detail').boundingBox();
      const stage = await page.locator('.map-stage').boundingBox();
      expect(detail!.y).toBeGreaterThanOrEqual(stage!.y - 1);
      expect(detail!.y + detail!.height).toBeLessThanOrEqual(stage!.y + stage!.height + 1);
      await marker.click();
    }
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.getByRole('button', { name: 'Reset world view', exact: true }).click();
    await expect(page.locator('[data-relay-code]')).toHaveCount(3);
    await expect(page.locator('.cluster-marker')).toHaveCount(0);
    await expect.poll(overlappingLabels).toBe(false);
  });

  test(`${renderer} map stops at world boundaries after drag, zoom and resize`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (renderer === 'vector') await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof original>) {
        if (String(args[0]).startsWith('webgl')) return null;
        return original.apply(this, args);
      } as typeof original;
    });
    await page.goto('/');
    const map = page.locator(`[data-map-renderer="${renderer}"]`);
    await expect(map).toHaveAttribute('data-world-left', /[-\d.]+/);
    async function boundaryErrors() {
      return map.evaluate(host => {
        const errors: string[] = [];
        const left = Number((host as HTMLElement).dataset.worldLeft), right = Number((host as HTMLElement).dataset.worldRight);
        const top = Number((host as HTMLElement).dataset.worldTop), bottom = Number((host as HTMLElement).dataset.worldBottom);
        const limitTop = Number((host as HTMLElement).dataset.limitTop ?? top), limitBottom = Number((host as HTMLElement).dataset.limitBottom ?? bottom);
        for (const [name, start, end, viewport] of [['x', left, right, host.clientWidth], ['y', limitTop, limitBottom, host.clientHeight]] as const) {
          if (start > 1 || end < viewport - 1) errors.push(`${name}: blank margin or dragged beyond cropped world`);
        }
        if ((host as HTMLElement).dataset.mapRenderer === 'accelerated') {
          const bounds = host.getBoundingClientRect();
          for (const marker of host.querySelectorAll<HTMLElement>('.maplibregl-marker')) {
            if (getComputedStyle(marker).display === 'none') continue;
            const anchor = host.parentElement!.querySelector(`[data-anchor-code="${marker.dataset.relayCode}"]`);
            if (!anchor) { errors.push('missing geographic anchor'); continue; }
            const rect = anchor.getBoundingClientRect();
            const lng = Number(marker.dataset.longitude), lat = Number(marker.dataset.latitude);
            const expectedX = bounds.left + left + (lng + 180) / 360 * (right - left);
            const expectedY = bounds.top + top + (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * (bottom - top);
            if (Math.abs(rect.left + rect.width / 2 - expectedX) > 2 || Math.abs(rect.top + rect.height / 2 - expectedY) > 2) errors.push(`wrapped anchor: ${marker.textContent}`);
          }
          for (const popup of host.querySelectorAll<HTMLElement>('.maplibregl-popup')) {
            if (getComputedStyle(popup).visibility === 'hidden' || popup.dataset.longitude === undefined) continue;
            const rect = popup.getBoundingClientRect();
            const lng = Number(popup.dataset.longitude), lat = Number(popup.dataset.latitude);
            const x = bounds.left + left + (lng + 180) / 360 * (right - left);
            const y = bounds.top + top + (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * (bottom - top);
            if (x < rect.left - 30 || x > rect.right + 30 || y < rect.top - 30 || y > rect.bottom + 30) errors.push('wrapped popup');
          }
        }
        return errors;
      });
    }
    await expect.poll(boundaryErrors).toEqual([]);
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    const box = await map.boundingBox();
    for (let i = 0; i < 8; i++) {
      const reverse = i >= 4;
      const from = reverse ? [.8, .75] : [.15, .15];
      const to = reverse ? [.15, .15] : [.8, .75];
      await page.mouse.move(box!.x + box!.width * from[0], box!.y + box!.height * from[1]);
      await page.mouse.down();
      await page.mouse.move(box!.x + box!.width * to[0], box!.y + box!.height * to[1], { steps: 8 });
      await page.mouse.up();
      await expect.poll(boundaryErrors).toEqual([]);
    }
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect.poll(boundaryErrors).toEqual([]);
    if (renderer === 'accelerated') {
      await page.getByRole('button', { name: 'Show locations', exact: true }).click();
      await page.getByRole('textbox', { name: 'Search locations' }).fill('Los Angeles');
      await page.getByRole('button', { name: /Los Angeles California LAX/ }).click();
      await expect(page.locator('.maplibregl-popup')).toBeVisible();
      await page.getByRole('textbox', { name: 'Search locations' }).fill('');
      await page.getByRole('button', { name: 'Hide locations', exact: true }).click();
      await page.getByRole('button', { name: 'Reset world view', exact: true }).click();
      await expect.poll(boundaryErrors).toEqual([]);
    }
    await page.setViewportSize({ width: 760, height: 600 });
    await page.getByRole('button', { name: 'Show locations', exact: true }).click();
    await expect.poll(boundaryErrors).toEqual([]);
  });
}
