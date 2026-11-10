import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createCatalogRepository } from './catalog.repository.mjs';
import {
  createRecommendationService,
  inferIntent,
} from './recommendation.service.mjs';
import { loadModel } from './server.mjs';

function createService(t) {
  const model = loadModel();
  const repository = createCatalogRepository({
    databasePath: ':memory:',
    model,
  });
  t.after(() => repository.close());
  return {
    model,
    repository,
    service: createRecommendationService({ repository, model }),
  };
}

test('ranking returns only catalog products and matching source attributes', (t) => {
  const { service, repository } = createService(t);
  const result = service.recommend('a light pack for weekend trails');
  const product = repository.getProduct(result.results[0].product.id);

  assert.equal(result.intentCategory, 'bags');
  assert.ok(result.results.length > 0);
  assert.ok(product);
  assert.ok(result.results[0].matchedDetails.length > 0);
  assert.equal(result.results[0].product.name, product.name);
  const catalogDetails = new Set([...product.attributes, ...product.matchTags]);
  assert.ok(
    result.results[0].matchedDetails.every((detail) =>
      catalogDetails.has(detail),
    ),
  );
  assert.ok(result.summary.includes(String(result.results.length)));
});

test('stores a keyed query fingerprint without persisting the original prompt', () => {
  const model = loadModel();
  const query = 'quiet headphones for focused work';
  const queryHashKey = Buffer.from('shopsense-test-key');
  let recordedQuery;
  const repository = {
    listProducts: () => model.seed.products,
    recordQuery: (record) => {
      recordedQuery = record;
    },
  };
  const service = createRecommendationService({
    repository,
    model,
    queryHashKey,
  });
  const expectedHash = createHmac('sha256', queryHashKey)
    .update(query)
    .digest('hex');

  const result = service.recommend(query);

  assert.equal(result.results[0].product.id, 'studio-headphones');
  assert.equal(result.results[0].product.matchTags, undefined);
  assert.ok(result.results[0].matchedDetails.length > 0);
  assert.equal(recordedQuery.queryHash, expectedHash);
  assert.equal(recordedQuery.queryHash.includes(query), false);
  assert.equal(recordedQuery.intentCategory, 'audio');
  assert.ok(recordedQuery.resultCount > 0);
});

test('category intent narrows recommendations to that category', (t) => {
  const { service } = createService(t);
  const result = service.recommend('fragrance-free care for dry skin');

  assert.equal(result.intentCategory, 'beauty');
  assert.ok(result.results.length > 0);
  assert.ok(result.results.every((item) => item.product.category === 'beauty'));
});

test('category intent supplies a label when no product details match', (t) => {
  const { service, model } = createService(t);
  const result = service.recommend('home');
  const categoryLabel = model.categories.find(
    (category) => category.id === 'home',
  )?.label;

  assert.equal(result.intentCategory, 'home');
  assert.ok(result.results.length > 0);
  assert.deepEqual(result.results[0].matchedDetails, [categoryLabel]);
});

test('unmatched requests return no fabricated product details', (t) => {
  const { service, model } = createService(t);
  const result = service.recommend('a purple titanium telescope for whales');

  assert.equal(result.results.length, 0);
  assert.equal(
    result.summary,
    model.copy.noResultsFor
      .replace('{count}', '0')
      .replace('{query}', 'a purple titanium telescope for whales'),
  );
});

test('normalizes accents, ignores stop words, and resolves a category from aliases', () => {
  const model = loadModel();
  const intent = inferIntent('Été A', model);
  const aliasIntent = inferIntent('quiet headphones', model);

  assert.deepEqual(intent.tokens, ['ete']);
  assert.equal(intent.categoryId, null);
  assert.equal(aliasIntent.categoryId, 'audio');
});

test('uses category IDs when localized category copy is missing', () => {
  const model = loadModel();
  Reflect.deleteProperty(model.copy.categories, 'bags');

  assert.equal(inferIntent('bags', model).categoryId, 'bags');
});

test('matches query prefixes contained by catalog tags and keeps sorting deterministic', () => {
  const model = loadModel();
  const repository = {
    listProducts: () => [
      {
        id: 'item-z',
        name: 'Widget Z',
        brand: 'Catalog',
        category: 'unlisted',
        priceCents: 100,
        description: 'A widget',
        imageUrl: '/widget-z.jpg',
        imageAlt: 'Widget Z',
        attributes: [],
        matchTags: ['widget'],
      },
      {
        id: 'item-a',
        name: 'Widget A',
        brand: 'Catalog',
        category: 'unlisted',
        priceCents: 100,
        description: 'A widget',
        imageUrl: '/widget-a.jpg',
        imageAlt: 'Widget A',
        attributes: [],
        matchTags: ['widget'],
      },
    ],
    recordQuery: () => {},
  };
  const service = createRecommendationService({ repository, model });
  const results = service.recommend('widgets');

  assert.deepEqual(
    results.results.map((item) => item.product.id),
    ['item-a', 'item-z'],
  );
  assert.deepEqual(results.results[0].matchedDetails, ['widget']);
});

test('returns no invented details when a matching product has an unlisted category', () => {
  const model = loadModel();
  const repository = {
    listProducts: () => [
      {
        id: 'unknown-category-item',
        name: 'Marble lamp',
        brand: 'Catalog',
        category: 'unlisted',
        priceCents: 100,
        description: 'A marble object',
        imageUrl: '/marble-lamp.jpg',
        imageAlt: 'Marble lamp',
        attributes: [],
        matchTags: [],
      },
    ],
    recordQuery: () => {},
  };
  const result = createRecommendationService({ repository, model }).recommend(
    'marble',
  );

  assert.equal(result.results.length, 1);
  assert.deepEqual(result.results[0].matchedDetails, []);
});
