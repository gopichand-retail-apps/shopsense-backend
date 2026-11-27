import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { readAiConfiguration } from '../ai/configuration.mjs';
import { ProviderError } from '../ai/gemini-provider.mjs';
import { createApiServer, loadModel, routeTemplate } from '../server.mjs';

const NOW = new Date('2026-11-24T12:00:00.000Z');
const ago = (minutes) =>
  new Date(NOW.getTime() - minutes * 60_000).toISOString();
const seed = loadModel().seed.products;
const target = seed[0];

// Publishes every seed product; the first one is in stock at store A and out of stock at store B.
function controlledFeed(store, { products }) {
  store.upsertLocations([
    { id: 'store-a', name: 'Store A' },
    { id: 'store-b', name: 'Store B' },
  ]);
  for (const product of products)
    store.publishOffer({
      merchantId: 'm-1',
      sku: `SKU-${product.id}`,
      productId: product.id,
      sourceVersion: 1,
      priceCents: product.priceCents,
      currency: 'USD',
      updatedAt: ago(120),
    });
  const stock = (locationId, state) => ({
    merchantId: 'm-1',
    sku: `SKU-${target.id}`,
    locationId,
    state,
    confirmedAt: ago(10),
    sourceVersion: 1,
  });
  store.recordAvailability(stock('store-a', 'in_stock'));
  store.recordAvailability(stock('store-b', 'out_of_stock'));
  store.withdrawOffer({
    merchantId: 'm-1',
    sku: `SKU-${seed[1].id}`,
    sourceVersion: 2,
    withdrawnAt: ago(5),
  });
}

async function start(t, options = {}) {
  const api = createApiServer({
    databasePath: ':memory:',
    now: () => NOW,
    offerFeed: controlledFeed,
    ...options,
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(() => api.close());
  const base = `http://127.0.0.1:${api.server.address().port}`;
  return {
    get: async (path) => {
      const response = await fetch(`${base}${path}`);
      return { status: response.status, body: await response.json() };
    },
    search: async (body) => {
      const response = await fetch(`${base}/api/v2/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

test('v2 routes are logged under their own templates', () => {
  for (const path of [
    '/api/v2/locations',
    '/api/v2/catalog',
    '/api/v2/search',
    '/api/v2/feed-status',
  ])
    assert.equal(routeTemplate(path), path);
});

test('locations and feed status come from the offer projection', async (t) => {
  const api = await start(t);

  const locations = await api.get('/api/v2/locations');
  const status = await api.get('/api/v2/feed-status');

  assert.equal(locations.status, 200);
  assert.deepEqual(locations.body.data.locations, [
    { id: 'store-a', name: 'Store A' },
    { id: 'store-b', name: 'Store B' },
  ]);
  assert.deepEqual(status.body.data, {
    state: 'ready',
    asOf: ago(10),
    generatedAt: NOW.toISOString(),
    maxAgeMinutes: 1440,
    offerCount: seed.length - 1,
    withdrawnCount: 1,
    locationCount: 2,
  });
});

test('the default synthetic feed publishes the catalog at two stores', async (t) => {
  const api = await start(t, { offerFeed: 'sample' });

  const status = await api.get('/api/v2/feed-status');

  assert.equal(status.body.data.offerCount, seed.length);
  assert.equal(status.body.data.locationCount, 2);
  assert.equal(status.body.data.state, 'ready');
});

test('an empty install reports an empty catalog to search and status', async (t) => {
  const api = await start(t, { offerFeed: 'none' });

  const status = await api.get('/api/v2/feed-status');
  const search = await api.search({ query: 'black headphones' });

  assert.equal(status.body.data.state, 'empty');
  assert.equal(status.body.data.offerCount, 0);
  assert.equal(search.status, 200);
  assert.deepEqual(search.body.data.results, []);
  assert.equal(search.body.data.catalog.state, 'empty');
});

test('catalog pages carry offers and the requested store availability', async (t) => {
  const api = await start(t);

  const page = await api.get(
    '/api/v2/catalog?location=store-a&limit=2&offset=0',
  );

  assert.equal(page.status, 200);
  assert.equal(page.body.data.items.length, 2);
  assert.equal(page.body.data.total, seed.length - 1);
  const [first] = page.body.data.items;
  assert.equal(first.offer.sku, `SKU-${first.id}`);
  assert.equal(first.availability.locationId, 'store-a');
  assert.equal(first.matchTags, undefined);
  assert.equal(page.body.data.catalog.state, 'ready');
});

test('id lookup omits withdrawn and unknown products and names them', async (t) => {
  const api = await start(t);

  const page = await api.get(
    `/api/v2/catalog?ids=${target.id},${seed[1].id},missing-id`,
  );

  assert.deepEqual(
    page.body.data.items.map((item) => item.id),
    [target.id],
  );
  assert.deepEqual(page.body.data.unavailableIds, [seed[1].id, 'missing-id']);
});

test('search applies the store and in-stock constraint and links matches to attributes', async (t) => {
  const api = await start(t);
  const body = (location) => ({
    query: target.name,
    location,
    filters: { availableOnly: true },
  });

  const atA = await api.search(body('store-a'));
  const atB = await api.search(body('store-b'));

  assert.equal(atA.status, 200);
  const hit = atA.body.data.results.find(
    (result) => result.product.id === target.id,
  );
  assert.equal(hit.product.availability.state, 'in_stock');
  assert.equal(hit.product.offer.currency, 'USD');
  assert.equal(hit.matches.length, hit.matchedDetails.length);
  for (const match of hit.matches.filter((item) => item.field === 'attributes'))
    assert.equal(hit.product.attributes[match.index], match.text);
  assert.equal(atA.body.data.assistance.status, 'catalog');
  assert.equal(atA.body.data.catalog.generatedAt, NOW.toISOString());
  assert.equal(
    atB.body.data.results.some((result) => result.product.id === target.id),
    false,
  );
});

test('unknown stores and in-stock filters without a store are rejected', async (t) => {
  const api = await start(t);

  const unknownSearch = await api.search({
    query: 'headphones',
    location: 'store-z',
  });
  const unknownCatalog = await api.get('/api/v2/catalog?location=store-z');
  const noStore = await api.search({
    query: 'headphones',
    filters: { availableOnly: true },
  });
  const extraField = await api.search({ query: 'headphones', price: 1 });

  assert.equal(unknownSearch.status, 400);
  assert.equal(unknownSearch.body.error.code, 'INVALID_LOCATION');
  assert.equal(unknownCatalog.body.error.code, 'INVALID_LOCATION');
  assert.equal(noStore.status, 400);
  assert.equal(noStore.body.error.code, 'INVALID_SEARCH');
  assert.equal(extraField.body.error.code, 'INVALID_SEARCH');
});

test('catalog query parameters are bounded', async (t) => {
  const api = await start(t);
  const tooMany = Array.from({ length: 51 }, (_, index) => `id-${index}`).join(
    ',',
  );

  for (const path of [
    '/api/v2/catalog?limit=0',
    '/api/v2/catalog?limit=101',
    '/api/v2/catalog?offset=-1',
    `/api/v2/catalog?ids=${tooMany}`,
    '/api/v2/catalog?category=not-a-category',
  ]) {
    const response = await api.get(path);
    assert.equal(response.status, 400, path);
  }
});

test('queries with SQL wildcard and quote characters are handled as text', async (t) => {
  const api = await start(t);

  const response = await api.search({ query: `100% "cotton" _blend's` });

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.data.results));
});

test('SS-03: with every remote provider disabled search works and makes no outbound call', async (t) => {
  const outbound = [];
  const original = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    if (!String(url).startsWith('http://127.0.0.1:'))
      outbound.push(String(url));
    return original(url, init);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  const api = await start(t, { aiConfiguration: readAiConfiguration({}) });

  const response = await api.search({
    query: target.name,
    useAi: true,
    location: 'store-a',
  });

  assert.equal(response.status, 200);
  assert.ok(response.body.data.results.length > 0);
  assert.deepEqual(response.body.data.assistance, {
    status: 'unavailable',
    provider: 'local',
    reason: 'not_configured',
  });
  assert.deepEqual(outbound, []);
});

test('SS-03: a provider that invents products or times out falls back to grounded catalog results', async (t) => {
  const configuration = readAiConfiguration({
    SHOPSENSE_AI_PROVIDER: 'ollama',
  });
  const cases = [
    [
      'invalid_response',
      async () => ({
        minimumPriceCents: null,
        maximumPriceCents: null,
        recommendations: [{ productId: 'fabricated', evidenceIndexes: [0] }],
      }),
    ],
    [
      'timeout',
      async () => {
        throw new ProviderError('timeout');
      },
    ],
  ];
  for (const [reason, select] of cases) {
    const api = await start(t, {
      aiConfiguration: configuration,
      recommendationProvider: { select },
    });

    const response = await api.search({
      query: target.name,
      useAi: true,
      location: 'store-a',
    });

    assert.equal(response.status, 200, reason);
    assert.deepEqual(response.body.data.assistance, {
      status: 'unavailable',
      provider: 'local',
      reason,
    });
    assert.ok(response.body.data.results.length > 0, reason);
    assert.ok(
      response.body.data.results.every(
        (result) => result.product.id !== 'fabricated',
      ),
    );
    assert.ok(response.body.data.catalog, reason);
  }
});

test('storage profiles without an offer projection answer 501 on v2 and keep v1 working', async (t) => {
  const repository = {
    storage: 'postgres',
    catalogPage: async () => [],
    retrieveProducts: async () => [],
    getProduct: async () => null,
    countProducts: async () => 0,
    recordQuery: async () => {},
    recordFeedback: async () => false,
    reserveAiRequest: async () => false,
    close: async () => {},
  };
  const api = await start(t, { repository });

  const v2 = await api.search({ query: 'headphones' });
  const locations = await api.get('/api/v2/locations');
  const v1 = await api.get('/api/v1/catalog');

  assert.equal(v2.status, 501);
  assert.equal(v2.body.error.code, 'OFFERS_NOT_SUPPORTED');
  assert.equal(locations.status, 501);
  assert.equal(v1.status, 200);
});
