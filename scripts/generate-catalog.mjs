import { mkdirSync, writeFileSync } from 'node:fs';
import {
  buildSampleCatalog,
  families,
  palette,
} from '../src/catalog/sample-catalog.mjs';

const products = buildSampleCatalog();
const dataDirectory = new URL('../data/', import.meta.url);
const imageDirectory = new URL(
  '../../shopsense-frontend/public/catalog/',
  import.meta.url,
);
mkdirSync(dataDirectory, { recursive: true });
mkdirSync(imageDirectory, { recursive: true });
writeFileSync(
  new URL('catalog.sample.json', dataDirectory),
  `${JSON.stringify({ version: 1, synthetic: true, products }, null, 2)}\n`,
);

const colors = {
  black: '#222a2b',
  navy: '#263b5d',
  red: '#a33f3d',
  green: '#35644e',
  white: '#e9e5dd',
};
const artwork = {
  dress:
    '<path d="M135 55h50l12 55 40 110H83l40-110z"/><path d="M135 55l25 28 25-28" fill="none"/>',
  shirt:
    '<path d="M120 65l25-15h30l25 15 40 40-30 30-20-20v110h-60V115l-20 20-30-30z"/>',
  pants: '<path d="M115 55h90l-9 175h-35l-1-100-1 100h-35z"/>',
  shoes:
    '<path d="M85 155l20-55 45 5 20 40 55 20 15 30H75z"/><path d="M80 200h160" fill="none"/>',
  headphones:
    '<path d="M100 160v-45a60 60 0 01120 0v45" fill="none" stroke-width="18"/><rect x="85" y="135" width="40" height="70" rx="15"/><rect x="195" y="135" width="40" height="70" rx="15"/>',
  earbuds:
    '<rect x="100" y="140" width="120" height="80" rx="26"/><path d="M125 120V80q-25-30-35 0 0 25 25 20v35M195 120V80q25-30 35 0 0 25-25 20v35" fill="none" stroke-width="15"/>',
  bottle:
    '<rect x="125" y="70" width="70" height="160" rx="20"/><rect x="137" y="45" width="46" height="30" rx="6"/>',
  mug: '<path d="M105 95h95v105q-48 40-95 0z"/><path d="M200 110q70-15 35 60l-35 10" fill="none" stroke-width="15"/>',
  sunglasses:
    '<path d="M65 115h75l20 10 20-10h75l-15 65h-55l-15-45h-20l-15 45H80z"/><path d="M65 115l-15-20m205 20 15-20" fill="none"/>',
  backpack:
    '<rect x="100" y="70" width="120" height="160" rx="35"/><path d="M135 75V50h50v25" fill="none" stroke-width="10"/><rect x="120" y="150" width="80" height="60" rx="12"/>',
};
for (const [type] of families) {
  for (const color of palette) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 280" role="img">
<title>${color} ${type} sample illustration</title><rect width="320" height="280" fill="#e9efeb"/>
<g fill="${colors[color]}" stroke="#586c62" stroke-width="3" stroke-linejoin="round">${artwork[type]}</g>
<text x="160" y="260" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#4c6358">SAMPLE CATALOG</text></svg>`;
    writeFileSync(new URL(`${type}-${color}.svg`, imageDirectory), svg);
  }
}
process.stdout.write(
  `Generated ${products.length} synthetic products and 50 original SVG illustrations.\n`,
);
