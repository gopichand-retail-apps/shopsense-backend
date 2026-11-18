import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApiServer } from '../server.mjs';
import { buildSampleCatalog } from './sample-catalog.mjs';
import {
  locateProduct,
  storeLayout,
  withStoreLayout,
} from './store-layout.mjs';

async function apiFixture(t, extra = {}) {
  const api = createApiServer({
    databasePath: ':memory:',
    catalogProducts: buildSampleCatalog(),
    ...extra,
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(() => api.close());
  return `http://127.0.0.1:${api.server.address().port}/api/v1`;
}

test('HTTP refinements narrow products and handle conflicts and zero budgets', async (t) => {
  const origin = await apiFixture(t);
  for (const [query, filters, count] of [
    ['shirt', { audience: 'men', color: 'black', maximumPriceCents: 2500 }, 2],
    ['black shirt', { color: 'white' }, 0],
    ['headphones not black', { color: 'black' }, 0],
    ['bottle over $20', { maximumPriceCents: 1500 }, 0],
    ['shirt', { maximumPriceCents: 0 }, 0],
  ]) {
    const response = await fetch(`${origin}/search`, {
      method: 'POST',
      body: JSON.stringify({ query, filters, useAi: false }),
    });
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.totalMatches, count);
    for (const { product } of data.results) {
      assert.equal(product.color, filters.color);
      assert.equal(product.audience, filters.audience);
      assert.ok(product.priceCents <= filters.maximumPriceCents);
      assert.equal(product.location.aisle, 'A2');
    }
  }
});

test('HTTP filter validation rejects unsupported facets, coercion, unknown fields and negative budgets', async (t) => {
  const origin = await apiFixture(t);
  for (const filters of [
    { audience: 'admin' },
    { color: 'purple' },
    { maximumPriceCents: -1 },
    { maximumPriceCents: '2500' },
    { maximumPriceCents: 1.5 },
    { tenantId: 'another-store' },
  ]) {
    const response = await fetch(`${origin}/search`, {
      method: 'POST',
      body: JSON.stringify({ query: 'shirt', filters }),
    });
    assert.equal(response.status, 400);
  }
});

test('AI receives only the products eligible for the customer-selected facets', async (t) => {
  let calls = 0;
  const origin = await apiFixture(t, {
    aiConfiguration: {
      provider: 'gemini',
      apiKey: 'synthetic',
      maximumConcurrent: 2,
      dailyRequestLimit: 10,
    },
    recommendationProvider: {
      select: async ({ products }) => {
        calls += 1;
        assert.ok(products.length > 0);
        assert.ok(
          products.every(
            (product) =>
              product.audience === 'women' && product.color === 'navy',
          ),
        );
        return {
          minimumPriceCents: null,
          maximumPriceCents: null,
          recommendations: [
            { productId: products[0].id, evidenceIndexes: [0] },
          ],
        };
      },
    },
  });
  const response = await fetch(`${origin}/search`, {
    method: 'POST',
    body: JSON.stringify({
      query: 'dress',
      filters: { audience: 'women', color: 'navy' },
      useAi: true,
    }),
  });
  const { data } = await response.json();
  assert.equal(calls, 1);
  assert.equal(data.assistance.status, 'assisted');
  assert.equal(data.results[0].product.location.aisle, 'A1');
});

test('store layout is versioned and locations are assigned only from that virtual layout', async (t) => {
  const origin = await apiFixture(t);
  const { data } = await (await fetch(`${origin}/store-layout`)).json();
  assert.equal(data.version, 1);
  assert.equal(data.aisles.length, 10);
  for (const product of buildSampleCatalog()) {
    const located = locateProduct(product);
    assert.ok(data.aisles.some((aisle) => aisle.id === located.location.aisle));
    assert.equal(located.location.virtual, true);
  }
  const unknown = { id: 'unknown', category: 'unsupported' };
  assert.equal(locateProduct(unknown), unknown);
  const wrapped = withStoreLayout({
    getProduct: async (id) =>
      id === 'missing'
        ? null
        : {
            category: 'apparel',
            productType: 'jacket',
            color: 'black',
          },
    listProducts: () => [{ category: 'audio', productType: 'earbuds' }],
  });
  assert.equal(await wrapped.getProduct('missing'), null);
  assert.equal((await wrapped.getProduct('known')).location.aisle, 'A4');
  assert.equal((await wrapped.listProducts())[0].location.rack, 'R2');
  assert.equal(storeLayout.id, data.id);
});
