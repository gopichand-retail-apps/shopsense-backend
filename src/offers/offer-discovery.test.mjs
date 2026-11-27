import assert from 'node:assert/strict';
import test from 'node:test';
import { createCatalogRepository } from '../catalog.repository.mjs';
import { loadModel } from '../server.mjs';
import { effectiveAvailability } from './availability.mjs';
import { createOfferDiscovery, deriveMatches } from './offer-discovery.mjs';

const NOW = new Date('2026-11-24T12:00:00.000Z');
const MINUTE_MS = 60_000;
const ago = (minutes) =>
  new Date(NOW.getTime() - minutes * MINUTE_MS).toISOString();
const headphones = (id, name, extra = {}) => ({
  id,
  name,
  brand: 'Acme',
  category: 'audio',
  priceCents: 12900,
  description: 'Closed back headphones for studio work',
  imageUrl: '/catalog/headphones-black.svg',
  imageAlt: 'Headphones',
  attributes: ['Closed back', 'Noise cancelling'],
  matchTags: ['headphones', 'studio'],
  color: 'black',
  audience: 'unisex',
  productType: 'headphones',
  ...extra,
});
const stock = (id, locationId, state, confirmedAt, sourceVersion = 1) => ({
  merchantId: 'm-1',
  sku: `SKU-${id}`,
  locationId,
  state,
  confirmedAt,
  sourceVersion,
});

function setup(
  t,
  {
    products = [headphones('hp-1', 'Studio Headphones X')],
    offers = true,
  } = {},
) {
  const clock = { now: NOW };
  const model = loadModel();
  const repository = createCatalogRepository({
    databasePath: ':memory:',
    model,
    catalogProducts: products,
    now: () => clock.now,
  });
  t.after(() => repository.close());
  const store = repository.offers;
  store.upsertLocations([
    { id: 'store-a', name: 'Store A' },
    { id: 'store-b', name: 'Store B' },
  ]);
  if (offers)
    for (const product of products)
      store.publishOffer({
        merchantId: 'm-1',
        sku: `SKU-${product.id}`,
        productId: product.id,
        sourceVersion: 1,
        priceCents: product.priceCents,
        currency: 'USD',
        updatedAt: ago(60),
      });
  const discovery = createOfferDiscovery({
    repository,
    model,
    now: () => clock.now,
    maxAgeMinutes: 1440,
  });
  return { clock, discovery, store };
}

test('SS-02: location, availability and price apply before ranking and track price changes', async (t) => {
  const { discovery, store } = setup(t);
  store.recordAvailability(stock('hp-1', 'store-a', 'in_stock', ago(30)));
  store.recordAvailability(stock('hp-1', 'store-b', 'out_of_stock', ago(30)));
  const search = (locationId) =>
    discovery.recommend('black headphones under $150', {
      locationId,
      availableOnly: true,
    });

  const atA = await search('store-a');
  assert.equal(atA.results.length, 1);
  assert.equal(atA.results[0].product.availability.state, 'in_stock');
  assert.equal(atA.results[0].product.offer.sku, 'SKU-hp-1');
  assert.equal((await search('store-b')).results.length, 0);

  store.publishOffer({
    merchantId: 'm-1',
    sku: 'SKU-hp-1',
    productId: 'hp-1',
    sourceVersion: 2,
    priceCents: 15900,
    currency: 'USD',
    updatedAt: ago(1),
  });
  assert.equal((await search('store-a')).results.length, 0);
  assert.equal((await search('store-b')).results.length, 0);
});

test('missing or stale inventory never produces an in-stock claim', async (t) => {
  const { discovery, store } = setup(t, {
    products: [
      headphones('hp-1', 'Stale Headphones'),
      headphones('hp-2', 'Unrecorded Headphones'),
      headphones('hp-3', 'Fresh Headphones'),
    ],
  });
  store.recordAvailability(stock('hp-1', 'store-a', 'in_stock', ago(1441)));
  store.recordAvailability(stock('hp-3', 'store-a', 'in_stock', ago(5)));

  const browse = await discovery.recommend('headphones', {
    locationId: 'store-a',
  });
  const byId = Object.fromEntries(
    browse.results.map((r) => [r.product.id, r.product.availability]),
  );
  assert.deepEqual(byId['hp-1'], {
    locationId: 'store-a',
    state: 'unknown',
    confirmedAt: ago(1441),
    stale: true,
  });
  assert.deepEqual(byId['hp-2'], {
    locationId: 'store-a',
    state: 'unknown',
    confirmedAt: null,
    stale: false,
  });
  assert.equal(byId['hp-3'].state, 'in_stock');

  const mandatory = await discovery.recommend('headphones', {
    locationId: 'store-a',
    availableOnly: true,
  });
  assert.deepEqual(
    mandatory.results.map((r) => r.product.id),
    ['hp-3'],
  );
});

test('a confirmation exactly at the limit is fresh and one millisecond older is stale', () => {
  const at = (iso) =>
    effectiveAvailability(
      { state: 'in_stock', confirmedAt: iso },
      { locationId: 'store-a', now: NOW, maxAgeMinutes: 1440 },
    );

  assert.equal(at('2026-11-23T12:00:00.000Z').state, 'in_stock');
  assert.equal(at('2026-11-23T11:59:59.999Z').state, 'unknown');
  assert.equal(at('2026-11-23T11:59:59.999Z').stale, true);
});

test('searching without a location reports no availability and still returns offers', async (t) => {
  const { discovery, store } = setup(t);
  store.recordAvailability(stock('hp-1', 'store-a', 'in_stock', ago(5)));

  const result = await discovery.recommend('black headphones under $150', {});

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].product.availability, null);
  assert.equal(result.results[0].product.priceCents, 12900);
});

test('an empty install is reported as empty, not as a failed search', async (t) => {
  const { discovery } = setup(t, { offers: false });

  const result = await discovery.recommend('black headphones', {});

  assert.deepEqual(result.results, []);
  assert.equal(result.catalog.state, 'empty');
  assert.equal(result.catalog.asOf, null);
});

test('a query with no match on a populated catalog is ready, not empty', async (t) => {
  const { discovery, store } = setup(t);
  store.recordAvailability(stock('hp-1', 'store-a', 'in_stock', ago(5)));

  const result = await discovery.recommend('zzqq nonsense words', {});

  assert.deepEqual(result.results, []);
  assert.equal(result.catalog.state, 'ready');
  assert.equal(result.catalog.asOf, ago(5));
  assert.equal(result.catalog.generatedAt, NOW.toISOString());
});

test('the catalog is stale when nothing has been confirmed within the limit', async (t) => {
  const { discovery, store, clock } = setup(t);
  store.recordAvailability(stock('hp-1', 'store-a', 'in_stock', ago(5)));
  assert.equal(discovery.freshness().state, 'ready');

  clock.now = new Date(NOW.getTime() + 1441 * MINUTE_MS);

  assert.equal(discovery.freshness().state, 'stale');
  assert.equal(
    (await discovery.recommend('headphones', {})).catalog.state,
    'stale',
  );
});

test('availability filtering happens before the ranking cap', async (t) => {
  const products = Array.from({ length: 45 }, (_, index) =>
    headphones(
      `hp-${String(index).padStart(2, '0')}`,
      `Headphones ${String(index).padStart(2, '0')}`,
    ),
  );
  const { discovery, store } = setup(t, { products });
  store.recordAvailability(stock('hp-44', 'store-a', 'in_stock', ago(5)));

  const result = await discovery.recommend('headphones', {
    locationId: 'store-a',
    availableOnly: true,
  });

  assert.deepEqual(
    result.results.map((r) => r.product.id),
    ['hp-44'],
  );
  assert.equal(result.totalMatches, 1);
});

test('browse returns offers and reports withdrawn or unknown saved ids', async (t) => {
  const { discovery, store } = setup(t, {
    products: [
      headphones('hp-1', 'Kept Headphones'),
      headphones('hp-2', 'Withdrawn Headphones'),
    ],
  });
  store.withdrawOffer({
    merchantId: 'm-1',
    sku: 'SKU-hp-2',
    sourceVersion: 2,
    withdrawnAt: ago(1),
  });
  store.recordAvailability(stock('hp-1', 'store-a', 'in_stock', ago(5)));

  const page = await discovery.browse({
    ids: ['hp-1', 'hp-2', 'missing'],
    locationId: 'store-a',
  });

  assert.deepEqual(
    page.items.map((item) => item.id),
    ['hp-1'],
  );
  assert.equal(page.items[0].availability.state, 'in_stock');
  assert.deepEqual(page.unavailableIds, ['hp-2', 'missing']);
  assert.equal(page.catalog.state, 'ready');
  const all = await discovery.browse({ limit: 24, offset: 0 });
  assert.equal(all.total, 1);
});

test('matched details link to the stored attribute they came from', () => {
  const attributes = ['Closed back', 'Noise cancelling'];

  assert.deepEqual(deriveMatches(attributes, ['Noise cancelling', 'studio']), [
    { field: 'attributes', index: 1, text: 'Noise cancelling' },
    { field: 'tags', text: 'studio' },
  ]);
  assert.deepEqual(deriveMatches(attributes, []), []);
});
