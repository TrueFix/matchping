import { describe, expect, it } from 'vitest';
import { countryPlaces } from './basemap';
import { layoutCountryLabels } from './country-label-layout';
import { labelsOverlap } from './relay-label-layout';

const project = (longitude: number, latitude: number) => ({ x: (longitude + 180) / 360 * 1600, y: (75 - latitude) / 130 * 800 });

describe('country names', () => {
  it('uses real bundled names and mainland label positions', () => {
    const india = countryPlaces.find(country => country.name === 'India')!;
    const france = countryPlaces.find(country => country.name === 'France')!;
    expect(india.longitude).toBeGreaterThan(70);
    expect(france.longitude).toBeGreaterThan(-5);
    expect(france.longitude).toBeLessThan(10);
    expect(countryPlaces.some(country => country.name === 'Antarctica')).toBe(false);
  });
  it('keeps labels inside the map and clear of relay labels and controls', () => {
    const obstacle = { left: 900, top: 250, width: 220, height: 160 };
    const labels = layoutCountryLabels(project, 1600, 800, 4, [obstacle]);
    expect(labels.length).toBeGreaterThan(15);
    labels.forEach((label, i) => {
      expect(labelsOverlap(label, obstacle, 5)).toBe(false);
      expect(label.left).toBeGreaterThanOrEqual(6);
      expect(label.top).toBeGreaterThanOrEqual(6);
      labels.slice(i + 1).forEach(other => expect(labelsOverlap(label, other, 5)).toBe(false));
    });
  });
});
