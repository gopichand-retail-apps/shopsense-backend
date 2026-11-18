import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createCatalogRepository } from '../catalog.repository.mjs';
import { createRecommendationService } from '../recommendation.service.mjs';
import { createApiServer, loadModel } from '../server.mjs';
import { buildSampleCatalog, loadSampleCatalog } from './sample-catalog.mjs';
import { matchesFilters, parseCatalogQuery } from './search-query.mjs';

function fixture(t) {
  const model = loadModel();
  const repository = createCatalogRepository({
    model,
    databasePath: ':memory:',
    catalogProducts: buildSampleCatalog(),
  });
  t.after(() => repository.close());
  return {
    repository,
    service: createRecommendationService({ repository, model }),
  };
}

test('sample catalog has 30 unique products per family, real metadata and reproducible source', () => {
  const products = buildSampleCatalog();
  assert.equal(products.length, 300);
  assert.equal(new Set(products.map((product) => product.id)).size, 300);
  assert.equal(new Set(products.map((product) => product.name)).size, 300);
  assert.equal(
    products.filter((product) => product.productType === 'dress').length,
    30,
  );
  assert.deepEqual(loadSampleCatalog(), products);
  assert.ok(
    products.every((product) => product.imageUrl.startsWith('/catalog/')),
  );
});

test('database stores 308 products and pages catalog independently of browser state', (t) => {
  const { repository } = fixture(t);
  assert.equal(repository.countProducts(), 308);
  const first = repository.catalogPage({});
  const second = repository.catalogPage({ offset: 24 });
  assert.equal(first.length, 24);
  assert.equal(second.length, 24);
  assert.ok(
    second.every((product) => !first.some((other) => other.id === product.id)),
  );
  assert.equal(
    repository.catalogPage({ category: 'home', limit: 100 }).length,
    31,
  );
  assert.deepEqual(
    repository
      .catalogPage({ ids: ['sample-backpack-30'] })
      .map((item) => item.id),
    ['sample-backpack-30'],
  );
});

test('black dress is broad, but black dress for men strictly excludes other audiences and garments', async (t) => {
  const { service } = fixture(t);
  const broad = await service.recommend('black dress');
  assert.equal(broad.resultCount, 6);
  assert.equal(
    new Set(broad.results.map((item) => item.product.audience)).size,
    3,
  );
  const men = await service.recommend('black dress for men');
  assert.equal(men.resultCount, 2);
  assert.ok(
    men.results.every(
      ({ product }) =>
        product.color === 'black' &&
        product.audience === 'men' &&
        product.productType === 'dress',
    ),
  );
  assert.equal(
    (await service.recommend('black dress for women')).resultCount,
    2,
  );
  assert.equal(
    (await service.recommend('black dress for kids')).resultCount,
    2,
  );
});

test('retrieval applies prices, color exclusions, aliases and bounded model context', async (t) => {
  const { service } = fixture(t);
  const headphones = await service.retrieve('headphones');
  assert.ok(headphones.total >= 30);
  assert.ok(headphones.ranked.length <= 36);
  const budget = await service.recommend('water bottle under $20');
  assert.ok(budget.results.every(({ product }) => product.priceCents < 2000));
  assert.ok(budget.resultCount > 0);
  const excluded = await service.recommend('headphones not black');
  assert.ok(excluded.resultCount > 0);
  assert.ok(
    excluded.results.every(
      ({ product }) => product.color && product.color !== 'black',
    ),
  );
  assert.equal((await service.recommend('backpack under $0')).resultCount, 0);
  assert.ok(
    (await service.recommend('airpods')).results.every(
      ({ product }) => product.productType === 'earbuds',
    ),
  );
  assert.equal(
    (await service.recommend('titanium telescope for whales')).resultCount,
    0,
  );
});

test('price parsing handles inclusive/exclusive ranges, exact audience words and unsafe numbers', () => {
  assert.equal(parseCatalogQuery('women black shirt').audience, 'women');
  assert.equal(
    parseCatalogQuery('mens black dress shirt').productType,
    'shirt',
  );
  assert.equal(parseCatalogQuery('over $5 at most $20').minimumPriceCents, 501);
  assert.equal(
    parseCatalogQuery('over $5 at most $20').maximumPriceCents,
    2000,
  );
  assert.equal(parseCatalogQuery('at least $20').minimumPriceCents, 2000);
  assert.equal(parseCatalogQuery('below $19.99').maximumPriceCents, 1998);
  assert.equal(
    parseCatalogQuery('under 9999999999999999999999999999').maximumPriceCents,
    null,
  );
  assert.equal(
    matchesFilters(
      { name: 'Unknown', priceCents: 10 },
      parseCatalogQuery('not black'),
    ),
    false,
  );
});

test('catalog HTTP pagination rejects malformed limits and resolves saved IDs outside the first page', async (t) => {
  const api = createApiServer({
    databasePath: ':memory:',
    catalogProducts: buildSampleCatalog(),
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(() => api.close());
  const origin = `http://127.0.0.1:${api.server.address().port}`;
  assert.equal(
    (await (await fetch(`${origin}/api/v1/health`)).json()).data.catalogCount,
    308,
  );
  for (const parameters of [
    'limit=0',
    'limit=101',
    'offset=-1',
    'offset=oops',
  ]) {
    assert.equal(
      (await fetch(`${origin}/api/v1/catalog?${parameters}`)).status,
      400,
    );
  }
  const response = await fetch(
    `${origin}/api/v1/catalog?ids=sample-backpack-30&limit=50`,
  );
  assert.equal((await response.json()).data[0].id, 'sample-backpack-30');
});
