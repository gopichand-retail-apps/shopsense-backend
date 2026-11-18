import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyCatalogPhoto } from './catalog-photos.mjs';
import { buildSampleCatalog } from './sample-catalog.mjs';

test('reviewed photographs match type, color and collection without changing stored product facts', () => {
  const products = buildSampleCatalog();
  const shirt = products.find((product) => product.id === 'sample-shirt-11');
  const presented = applyCatalogPhoto(shirt);
  assert.equal(presented.imageUrl, '/catalog/photos/shirt-black.jpg');
  assert.equal(presented.imageCredit.kind, 'style-reference');
  assert.equal(presented.priceCents, shirt.priceCents);
  assert.deepEqual(presented.attributes, shirt.attributes);
  assert.equal(
    applyCatalogPhoto({ ...shirt, id: 'merchant-product' }).imageUrl,
    shirt.imageUrl,
  );
  assert.equal(
    applyCatalogPhoto({ ...shirt, color: 'blue' }).imageUrl,
    shirt.imageUrl,
  );
  const dresses = products.filter(
    (product) => product.productType === 'dress' && product.color === 'black',
  );
  assert.equal(
    dresses.filter((product) => applyCatalogPhoto(product).imageCredit).length,
    2,
  );
  const manifest = JSON.parse(
    readFileSync(
      new URL('../../data/catalog-photos.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(manifest.assets.length, 3);
  assert.ok(
    manifest.assets.every(
      (asset) =>
        /^[a-f0-9]{64}$/.test(asset.sha256) &&
        asset.license === 'Pexels License',
    ),
  );
});
