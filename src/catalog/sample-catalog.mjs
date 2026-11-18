import { readFileSync } from 'node:fs';
import { z } from 'zod';

const families = [
  [
    'dress',
    'apparel',
    'Occasion Dress',
    4200,
    'Woven fabric',
    ['occasion', 'dress', 'clothing'],
  ],
  [
    'shirt',
    'apparel',
    'Everyday Shirt',
    2400,
    'Cotton blend',
    ['shirt', 'clothing', 'everyday'],
  ],
  [
    'pants',
    'apparel',
    'Everyday Pants',
    3600,
    'Cotton twill',
    ['pants', 'clothing', 'everyday'],
  ],
  [
    'shoes',
    'apparel',
    'Walking Shoes',
    5800,
    'Textile upper',
    ['walking', 'shoes', 'travel'],
  ],
  [
    'headphones',
    'audio',
    'Over-Ear Headphones',
    7900,
    'Padded ear cushions',
    ['music', 'focus', 'quiet', 'headphones'],
  ],
  [
    'earbuds',
    'audio',
    'Wireless Earbuds',
    4900,
    'In-ear design',
    ['music', 'wireless', 'earbuds', 'commute'],
  ],
  [
    'bottle',
    'outdoors',
    'Water Bottle',
    1800,
    'Stainless steel body',
    ['water', 'hiking', 'trail', 'bottle'],
  ],
  [
    'mug',
    'home',
    'Coffee Mug',
    1400,
    'Ceramic body',
    ['coffee', 'tea', 'mug', 'kitchen'],
  ],
  [
    'sunglasses',
    'accessories',
    'Everyday Sunglasses',
    2200,
    'Full-rim frame',
    ['sunglasses', 'shades', 'travel'],
  ],
  [
    'backpack',
    'bags',
    'Day Backpack',
    3800,
    'Woven shell',
    ['carry', 'pack', 'hiking', 'weekend', 'trails'],
  ],
];
const palette = ['black', 'navy', 'red', 'green', 'white'];
const audienceLabels = {
  women: "Women's",
  men: "Men's",
  kids: "Kids'",
  unisex: 'Unisex',
};

export function buildSampleCatalog() {
  return families.flatMap(
    ([productType, category, label, basePrice, material, tags]) =>
      Array.from({ length: 30 }, (_, index) => {
        const color = palette[index % palette.length];
        const audience = ['dress', 'shirt', 'pants', 'shoes'].includes(
          productType,
        )
          ? ['women', 'men', 'kids'][Math.floor(index / 10)]
          : 'unisex';
        const edition = [
          'Essential',
          'Travel',
          'Studio',
          'Daily',
          'Compact',
          'Signature',
        ][Math.floor(index / 5)];
        const name = `${title(color)} ${audienceLabels[audience]} ${label} - ${edition}`;
        return {
          id: `sample-${productType}-${String(index + 1).padStart(2, '0')}`,
          name,
          brand: 'ShopSense Sample',
          category,
          productType,
          color,
          audience,
          priceCents: basePrice + (index % 5) * 300,
          description: `Synthetic sample catalog item for product discovery: ${name.toLowerCase()}.`,
          imageUrl: `/catalog/${productType}-${color}.svg`,
          imageAlt: `${title(color)} ${label.toLowerCase()} illustration; sample artwork`,
          attributes: [
            material,
            `${title(color)} color`,
            `${audienceLabels[audience]} collection`,
            `${edition} style`,
          ],
          matchTags: [...tags, color, audience, 'synthetic sample'],
        };
      }),
  );
}

function title(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function loadSampleCatalog() {
  const value = JSON.parse(
    readFileSync(
      new URL('../../data/catalog.sample.json', import.meta.url),
      'utf8',
    ),
  );
  return z
    .object({
      version: z.literal(1),
      synthetic: z.literal(true),
      products: z.array(z.record(z.string(), z.unknown())),
    })
    .parse(value).products;
}

export { families, palette };
