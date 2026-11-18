import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApiServer, loadModel } from '../server.mjs';
import { createCatalogRepository } from '../catalog.repository.mjs';
import { createRecommendationService } from '../recommendation.service.mjs';
import { createAiRecommendations } from './recommendations.mjs';
import { readAiConfiguration } from './configuration.mjs';
import { ProviderError } from './gemini-provider.mjs';

const configuration = readAiConfiguration({
  SHOPSENSE_AI_PROVIDER: 'gemini',
  GEMINI_API_KEY: 'test-key',
  SHOPSENSE_AI_DAILY_REQUEST_LIMIT: '2',
});

function createService(
  t,
  { provider, config = configuration, fallbackRecommendationProvider } = {},
) {
  const model = loadModel();
  const repository = createCatalogRepository({
    model,
    databasePath: ':memory:',
  });
  t.after(() => repository.close());
  return createAiRecommendations({
    repository,
    model,
    local: createRecommendationService({ repository, model }),
    configuration: config,
    provider,
    fallbackRecommendationProvider,
  });
}

function selection(productId = 'studio-headphones') {
  return {
    minimumPriceCents: null,
    maximumPriceCents: null,
    recommendations: [{ productId, evidenceIndexes: [0] }],
  };
}

test('catalog-only API requests do not call a provider and unavailable AI is labeled', async (t) => {
  const service = createService(t, {
    provider: { select: () => assert.fail('must not call provider') },
  });
  assert.equal(
    (await service.recommend('quiet headphones')).assistance.status,
    'catalog',
  );
  const unavailable = createService(t, { config: readAiConfiguration({}) });
  assert.equal(
    (await unavailable.recommend('quiet headphones', { useAi: true }))
      .assistance.reason,
    'not_configured',
  );
});

test('a no-match search does not spend the budget reserved for real provider calls', async (t) => {
  let calls = 0;
  const service = createService(t, {
    config: { ...configuration, dailyRequestLimit: 1 },
    provider: {
      select: async () => {
        calls += 1;
        return selection();
      },
    },
  });
  assert.equal(
    (await service.recommend('titanium telescope', { useAi: true }))
      .resultCount,
    0,
  );
  const result = await service.recommend('quiet headphones', { useAi: true });
  assert.equal(result.assistance.status, 'assisted');
  assert.equal(calls, 1);
});

test('a separately configured Ollama provider can recover from a Gemini quota failure', async (t) => {
  const service = createService(t, {
    config: { ...configuration, fallbackProvider: 'ollama' },
    provider: {
      select: async () => {
        throw new ProviderError('quota');
      },
    },
    fallbackRecommendationProvider: { select: async () => selection() },
  });
  const result = await service.recommend('quiet headphones', { useAi: true });
  assert.equal(result.assistance.provider, 'ollama');
  assert.equal(result.assistance.status, 'assisted');
});

test('configured Ollama selection and an empty shortlist avoid invented catalog records', async (t) => {
  const service = createService(t, {
    config: { ...configuration, provider: 'ollama' },
    provider: { select: async () => selection() },
  });
  assert.equal(
    (await service.recommend('quiet headphones', { useAi: true })).assistance
      .provider,
    'ollama',
  );
  const empty = await service.recommend('nonexistent titanium telescope', {
    useAi: true,
  });
  assert.equal(empty.resultCount, 0);
  assert.equal(empty.assistance.provider, 'local');
});

test('persists daily reservations atomically, counts failures, and resets on a new UTC day', (t) => {
  const repository = createCatalogRepository({
    model: loadModel(),
    databasePath: ':memory:',
  });
  t.after(() => repository.close());
  assert.equal(repository.reserveAiRequest('2026-11-13', 2), true);
  assert.equal(repository.reserveAiRequest('2026-11-13', 2), true);
  assert.equal(repository.reserveAiRequest('2026-11-13', 2), false);
  assert.equal(repository.reserveAiRequest('2026-11-14', 2), true);
});

test('selects only grounded products and stops sending requests after the daily budget', async (t) => {
  let calls = 0;
  const service = createService(t, {
    provider: {
      select: async () => {
        calls += 1;
        return selection();
      },
    },
  });
  const result = await service.recommend('something for focus', {
    useAi: true,
    requestId: 'synthetic-request',
  });
  assert.equal(result.assistance.status, 'assisted');
  assert.equal(result.results[0].product.id, 'studio-headphones');
  await service.recommend('quiet headphones again', { useAi: true });
  assert.equal(
    (await service.recommend('quiet headphones', { useAi: true })).assistance
      .reason,
    'budget',
  );
  assert.equal(calls, 2);
});

test('AI no-match stays empty, and invalid selections and provider failures use labeled recovery', async (t) => {
  const empty = createService(t, {
    provider: { select: async () => ({ ...selection(), recommendations: [] }) },
  });
  assert.equal(
    (await empty.recommend('quiet headphones', { useAi: true })).resultCount,
    0,
  );
  for (const error of [
    new ProviderError('quota'),
    new Error('private provider details'),
  ]) {
    const service = createService(t, {
      provider: {
        select: async () => {
          throw error;
        },
      },
    });
    const result = await service.recommend('quiet headphones', { useAi: true });
    assert.equal(result.assistance.status, 'unavailable');
    assert.equal(
      result.assistance.reason,
      error instanceof ProviderError ? 'quota' : 'provider_error',
    );
    assert.ok(result.results.length > 0);
    assert.ok(!JSON.stringify(result).includes('private provider details'));
  }
  const invalid = createService(t, {
    provider: { select: async () => selection('fabricated') },
  });
  assert.equal(
    (await invalid.recommend('quiet headphones', { useAi: true })).assistance
      .reason,
    'invalid_response',
  );
});

test('concurrent requests are bounded and slots are released after completion', async (t) => {
  let complete;
  let started = Promise.withResolvers();
  const service = createService(t, {
    config: { ...configuration, maximumConcurrent: 1 },
    provider: {
      select: () =>
        new Promise((resolve) => {
          complete = resolve;
          started.resolve();
        }),
    },
  });
  const pending = service.recommend('quiet headphones', { useAi: true });
  await started.promise;
  assert.equal(
    (await service.recommend('quiet headphones', { useAi: true })).assistance
      .reason,
    'busy',
  );
  complete(selection());
  assert.equal((await pending).assistance.status, 'assisted');
  started = Promise.withResolvers();
  const next = service.recommend('quiet headphones', { useAi: true });
  await started.promise;
  complete(selection());
  assert.equal((await next).assistance.status, 'assisted');
});

test('HTTP search awaits AI and exposes capabilities without credentials', async (t) => {
  const api = createApiServer({
    databasePath: ':memory:',
    aiConfiguration: configuration,
    recommendationProvider: { select: async () => selection() },
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(() => api.close());
  const origin = `http://127.0.0.1:${api.server.address().port}`;
  const health = await (await fetch(`${origin}/api/v1/health`)).json();
  assert.deepEqual(health.data.ai, { available: true, provider: 'gemini' });
  assert.ok(!JSON.stringify(health).includes(configuration.apiKey));
  const response = await fetch(`${origin}/api/v1/search`, {
    method: 'POST',
    body: JSON.stringify({ query: 'quiet headphones', useAi: true }),
  });
  assert.equal((await response.json()).data.assistance.status, 'assisted');
});
