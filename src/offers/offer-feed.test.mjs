import assert from 'node:assert/strict';
import test from 'node:test';
import { createCatalogRepository } from '../catalog.repository.mjs';
import { loadSampleCatalog } from '../catalog/sample-catalog.mjs';
import { loadModel } from '../server.mjs';
import { readOfferConfiguration } from './configuration.mjs';
import { applyFeed, buildSampleFeed } from './offer-feed.mjs';

const NOW = new Date('2026-11-24T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function setup(t) {
  const clock = { now: NOW };
  const repository = createCatalogRepository({
    databasePath: ':memory:',
    model: loadModel(),
    catalogProducts: loadSampleCatalog(),
    now: () => clock.now,
  });
  t.after(() => repository.close());
  return Object.assign(repository, { clock });
}

test('the sample feed is deterministic and gives every product a synthetic SKU', (t) => {
  const repository = setup(t);
  const products = repository.listProducts();
  const first = buildSampleFeed({ products, now: NOW, currency: 'USD' });
  const second = buildSampleFeed({ products, now: NOW, currency: 'USD' });

  assert.deepEqual(first, second);
  assert.equal(first.offers.length, products.length);
  assert.ok(first.offers.every((item) => item.sku === `SYN-${item.productId}`));
  assert.ok(
    first.offers.every((item) => item.merchantId === 'synthetic-merchant-1'),
  );
  assert.deepEqual(
    first.locations.map((location) => location.id),
    ['store-a', 'store-b'],
  );
});

test('the sample feed exercises in stock, out of stock, missing and stale records', (t) => {
  const repository = setup(t);
  const feed = buildSampleFeed({
    products: repository.listProducts(),
    now: NOW,
    currency: 'USD',
  });
  const at = (locationId) =>
    feed.availability.filter((item) => item.locationId === locationId);
  const staleAt = (locationId) =>
    at(locationId).filter(
      (item) => NOW - Date.parse(item.confirmedAt) > DAY_MS,
    );

  for (const locationId of ['store-a', 'store-b']) {
    const states = new Set(at(locationId).map((item) => item.state));
    assert.ok(states.has('in_stock') && states.has('out_of_stock'), locationId);
    assert.ok(
      at(locationId).length < feed.offers.length,
      `${locationId} has missing records`,
    );
  }
  assert.ok(staleAt('store-b').length > 0);
  assert.ok(
    feed.availability.every(
      (item) => Date.parse(item.confirmedAt) <= NOW.getTime(),
    ),
  );
});

test('applying the feed twice leaves one row per offer and counts each outcome', (t) => {
  const repository = setup(t);
  const feed = buildSampleFeed({
    products: repository.listProducts(),
    now: NOW,
    currency: 'USD',
  });

  const first = applyFeed(repository.offers, feed);
  const second = applyFeed(repository.offers, feed);

  assert.equal(first.offers.created, feed.offers.length);
  assert.equal(second.offers.unchanged, feed.offers.length);
  assert.equal(second.availability.unchanged, feed.availability.length);
  assert.equal(repository.offers.feedStatus().offerCount, feed.offers.length);
});

test('a later start refreshes confirmations without conflicting on the offers', (t) => {
  const repository = setup(t);
  const products = repository.listProducts();
  applyFeed(
    repository.offers,
    buildSampleFeed({ products, now: NOW, currency: 'USD' }),
  );
  const later = new Date(NOW.getTime() + 60 * 60 * 1000);
  repository.clock.now = later;
  const restart = applyFeed(
    repository.offers,
    buildSampleFeed({ products, now: later, currency: 'USD' }),
  );

  assert.equal(restart.offers.unchanged, products.length);
  assert.ok(restart.availability.recorded > 0);
  assert.equal(restart.offers.conflict ?? 0, 0);
});

test('a rejected item rolls back the whole feed instead of applying part of it', (t) => {
  const repository = setup(t);
  const feed = buildSampleFeed({
    products: repository.listProducts(),
    now: NOW,
    currency: 'USD',
  });
  feed.offers.push({ ...feed.offers[0], sku: 'bad sku;' });

  assert.throws(() => applyFeed(repository.offers, feed));
  assert.equal(repository.offers.feedStatus().offerCount, 0);
  assert.equal(repository.offers.listLocations().length, 0);
});

test('availability freshness limit defaults to one day and rejects unusable values', () => {
  assert.deepEqual(readOfferConfiguration({}), {
    maxAgeMinutes: 1440,
    feed: 'sample',
  });
  assert.deepEqual(
    readOfferConfiguration({
      SHOPSENSE_AVAILABILITY_MAX_AGE_MINUTES: '90',
      SHOPSENSE_OFFER_FEED: 'none',
    }),
    { maxAgeMinutes: 90, feed: 'none' },
  );
  for (const value of ['0', '-5', 'soon', '20000'])
    assert.throws(() =>
      readOfferConfiguration({ SHOPSENSE_AVAILABILITY_MAX_AGE_MINUTES: value }),
    );
  assert.throws(() =>
    readOfferConfiguration({ SHOPSENSE_OFFER_FEED: 'remote' }),
  );
});
