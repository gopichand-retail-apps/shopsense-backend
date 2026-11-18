import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createCatalogRepository } from '../catalog.repository.mjs';
import { createRecommendationService } from '../recommendation.service.mjs';
import { createApiServer, loadModel } from '../server.mjs';
import { buildSampleCatalog } from './sample-catalog.mjs';

function fixture(t) {
  const model = loadModel();
  const repository = createCatalogRepository({
    databasePath: ':memory:',
    model,
    catalogProducts: buildSampleCatalog(),
  });
  t.after(() => repository.close());
  return {
    repository,
    service: createRecommendationService({ repository, model }),
  };
}

function assertStoredEvidence(result, repository) {
  for (const item of result.results) {
    const stored = repository.getProduct(item.product.id);
    assert.equal(item.product.priceCents, stored.priceCents);
    assert.deepEqual(item.product.attributes, stored.attributes);
    const facts = [...stored.attributes, ...stored.matchTags];
    assert.ok(item.matchedDetails.length > 0);
    assert.ok(item.matchedDetails.every((detail) => facts.includes(detail)));
  }
}

test('wedding and formal-event requests retrieve stored occasion wear', async (t) => {
  const { service, repository } = fixture(t);
  for (const query of [
    'something to wear to a wedding',
    'clothing for a formal event',
  ]) {
    const result = await service.recommend(query);
    assert.ok(result.results.length > 0);
    assert.ok(
      result.results.every((item) => item.product.productType === 'dress'),
    );
    assertStoredEvidence(result, repository);
  }
  const refined = await service.recommend(
    'wedding outfit for women not black under $50',
    { color: 'red' },
  );
  assert.ok(refined.results.length > 0);
  assert.ok(
    refined.results.every(
      ({ product }) =>
        product.audience === 'women' &&
        product.color === 'red' &&
        product.priceCents < 5000,
    ),
  );
  assertStoredEvidence(refined, repository);
});

test('keeping drinks cold requires recorded insulation rather than assuming every bottle is insulated', async (t) => {
  const { service, repository } = fixture(t);
  const result = await service.recommend('something to keep my drink cold');
  assert.deepEqual(
    result.results.map((item) => item.product.id),
    ['trail-bottle'],
  );
  assertStoredEvidence(result, repository);
  for (const query of [
    'keep water cold under $20',
    'a mug to keep coffee cold',
  ]) {
    assert.equal((await service.recommend(query)).results.length, 0);
  }
});

test('noise-blocking commute requests require recorded audio noise-reduction evidence', async (t) => {
  const { service, repository } = fixture(t);
  const result = await service.recommend(
    'something to block out noise on my commute',
  );
  assert.deepEqual(
    result.results.map((item) => item.product.id),
    ['studio-headphones'],
  );
  assertStoredEvidence(result, repository);
  const cheap = await service.recommend(
    'noise-cancelling headphones under $100',
  );
  assert.equal(cheap.results.length, 0);
});

test('supported noise negations exclude recorded cancellation instead of requiring it', async (t) => {
  const { service, repository } = fixture(t);
  for (const query of [
    'headphones without noise cancellation',
    'headphones with no active noise reduction',
    "I don't need noise-cancelling headphones",
    'headphones where noise cancellation is not needed',
  ]) {
    const result = await service.recommend(query);
    assert.ok(result.results.length > 0);
    assert.ok(
      result.results.every(({ product }) => product.id !== 'studio-headphones'),
    );
    assertStoredEvidence(result, repository);
  }
  const positive = await service.recommend(
    'not black, but noise-cancelling headphones',
  );
  assert.deepEqual(
    positive.results.map(({ product }) => product.id),
    [],
  );
  const required = await service.recommend(
    'not only headphones with noise cancellation',
  );
  assert.deepEqual(
    required.results.map(({ product }) => product.id),
    ['studio-headphones'],
  );
  const contrast = await service.recommend(
    'I do not want a bottle, but need noise-cancelling headphones',
  );
  assert.deepEqual(
    contrast.results.map(({ product }) => product.id),
    ['studio-headphones'],
  );
});

test('negated cold-drink and wedding needs do not add positive semantic requirements', async (t) => {
  const { service } = fixture(t);
  const cold = await service.retrieve("bottle but I don't need my drink cold");
  assert.deepEqual(cold.intent.requirements, []);
  assert.ok(cold.ranked.length > 1);
  const wedding = await service.retrieve('shirt, not for a wedding');
  assert.deepEqual(wedding.intent.requirements, []);
  assert.ok(wedding.ranked.length > 0);
});

test('need expansion preserves explicit types, conflicting facets and unknown-item no-match', async (t) => {
  const { service } = fixture(t);
  const shirt = await service.recommend('shirt for a wedding');
  assert.equal(shirt.results.length, 0);
  const bottle = await service.recommend('bottle for a wedding');
  assert.ok(bottle.results.length > 0);
  assert.ok(
    bottle.results.every(({ product }) => /bottle/i.test(product.name)),
  );
  for (const [query, filters] of [
    ['wedding outfit not black', { color: 'black' }],
    ['wedding outfit for women', { audience: 'men' }],
    ['a purple titanium telescope for whales', {}],
  ]) {
    assert.equal((await service.recommend(query, filters)).results.length, 0);
  }
});

test('HTTP AI search passes only evidence-backed semantic candidates to the provider', async (t) => {
  let candidates;
  const api = createApiServer({
    databasePath: ':memory:',
    catalogProducts: buildSampleCatalog(),
    aiConfiguration: {
      provider: 'gemini',
      apiKey: 'synthetic',
      maximumConcurrent: 2,
      dailyRequestLimit: 10,
    },
    recommendationProvider: {
      select: async ({ products }) => {
        candidates = products;
        return {
          minimumPriceCents: null,
          maximumPriceCents: null,
          recommendations: [
            { productId: products[0].id, evidenceIndexes: [1] },
          ],
        };
      },
    },
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(() => api.close());
  const response = await fetch(
    `http://127.0.0.1:${api.server.address().port}/api/v1/search`,
    {
      method: 'POST',
      body: JSON.stringify({
        query: 'something to keep my drink cold',
        useAi: true,
      }),
    },
  );
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(
    candidates.map((product) => product.id),
    ['trail-bottle'],
  );
  assert.equal(data.assistance.status, 'assisted');
  assert.equal(data.results[0].product.id, 'trail-bottle');
  assert.deepEqual(data.results[0].matchedDetails, ['Double-wall insulation']);
});
