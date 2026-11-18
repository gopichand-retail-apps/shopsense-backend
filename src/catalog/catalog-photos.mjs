import { readFileSync } from 'node:fs';

const { assets } = JSON.parse(
  readFileSync(
    new URL('../../data/catalog-photos.json', import.meta.url),
    'utf8',
  ),
);

export function applyCatalogPhoto(product) {
  if (!product.id?.startsWith('sample-')) return product;
  const photo = assets.find(
    (asset) =>
      asset.productType === product.productType &&
      asset.color === product.color &&
      (!asset.audience || asset.audience === product.audience),
  );
  if (!photo) return product;
  return {
    ...product,
    imageUrl: photo.imageUrl,
    imageAlt: photo.alt,
    imageCredit: {
      kind: 'style-reference',
      author: photo.author,
      source: photo.source,
      licenseUrl: photo.licenseUrl,
    },
  };
}
