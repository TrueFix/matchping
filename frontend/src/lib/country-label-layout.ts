import { countryPlaces } from './basemap';
import { labelsOverlap, type LabelRect } from './relay-label-layout';

export function layoutCountryLabels(project: (longitude: number, latitude: number) => { x: number; y: number }, width: number, height: number, zoom: number, obstacles: LabelRect[] = []) {
  const occupied = [...obstacles];
  const labels: (LabelRect & { id: string; name: string })[] = [];
  for (const country of countryPlaces) {
    if (zoom < country.minZoom) continue;
    for (const [longitude, latitude] of country.positions) {
      const point = project(longitude, latitude);
      const label = { id: country.id, name: country.name, left: point.x - (country.name.length * 7.5 + 10) / 2,
        top: point.y - 10, width: country.name.length * 7.5 + 10, height: 20 };
      if (label.left < 6 || label.top < 6 || label.left + label.width > width - 6 || label.top + label.height > height - 6) continue;
      if (occupied.some(rect => labelsOverlap(label, rect, 5))) continue;
      labels.push(label);
      occupied.push(label);
      break;
    }
  }
  return labels;
}
