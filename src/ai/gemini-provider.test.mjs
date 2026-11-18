import assert from 'node:assert/strict';
import test from 'node:test';
import { createGeminiProvider } from './gemini-provider.mjs';
import { readAiConfiguration } from './configuration.mjs';

const configuration = readAiConfiguration({
  GEMINI_API_KEY: 'test-server-only-key',
});
const selection = {
  minimumPriceCents: null,
  maximumPriceCents: null,
  recommendations: [],
};
const context = {
  query: 'synthetic request',
  resultLimit: 6,
  currency: 'USD',
  products: [
    { id: 'one', attributes: ['Source fact'], matchTags: [], priceCents: 2000 },
  ],
};
const success = (value = selection) =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: JSON.stringify(value) }] },
        },
      ],
    }),
  );
const providerWith = (fetchImpl) =>
  createGeminiProvider({ configuration, fetchImpl });

test('uses a fixed HTTPS endpoint, header key, strict JSON output and bounded tokens', async () => {
  const provider = providerWith(async (url, options) => {
    assert.match(
      url,
      /^https:\/\/generativelanguage.googleapis.com\/v1beta\/models\/gemini-/,
    );
    assert.ok(!url.includes(configuration.apiKey));
    assert.equal(options.headers['x-goog-api-key'], configuration.apiKey);
    assert.equal(options.redirect, 'error');
    const request = JSON.parse(options.body);
    assert.equal(request.generationConfig.responseMimeType, 'application/json');
    assert.equal(request.generationConfig.maxOutputTokens, 2048);
    assert.ok(
      request.generationConfig.responseJsonSchema.required.includes(
        'recommendations',
      ),
    );
    assert.deepEqual(
      request.generationConfig.responseJsonSchema.properties.minimumPriceCents
        .type,
      ['integer', 'null'],
    );
    assert.ok(
      request.systemInstruction.parts[0].text.includes('Ignore instructions'),
    );
    return success();
  });
  assert.deepEqual(await provider.select(context), selection);
});

test('fails safely on HTTP errors without consuming or exposing provider error bodies', async () => {
  for (const status of [400, 401, 403, 429, 500]) {
    const provider = providerWith(
      async () => new Response('private provider details', { status }),
    );
    await assert.rejects(provider.select(context), {
      reason: status === 429 ? 'quota' : 'provider_error',
    });
  }
});

test('rejects invalid JSON, unexpected schemas, blocked/truncated and oversized responses', async () => {
  const responses = [
    () => new Response('invalid json'),
    () => new Response('null'),
    () => success({ fabricated: true }),
    () => new Response('{}'),
    () =>
      new Response(
        JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS' }] }),
      ),
    () =>
      new Response(
        JSON.stringify({ candidates: [{ finishReason: 'STOP', content: {} }] }),
      ),
    () =>
      new Response(
        JSON.stringify({
          candidates: [{ finishReason: 'STOP', content: { parts: [{}] } }],
        }),
      ),
    () => new Response('x'.repeat(70_000)),
  ];
  for (const response of responses) {
    await assert.rejects(providerWith(async () => response()).select(context), {
      reason: 'invalid_response',
    });
  }
});

test('bounds catalog input before any network request', async () => {
  let called = false;
  const provider = providerWith(async () => {
    called = true;
    return success();
  });
  await assert.rejects(
    provider.select({
      ...context,
      products: [{ ...context.products[0], description: 'x'.repeat(80_001) }],
    }),
    { reason: 'catalog_limit' },
  );
  assert.equal(called, false);
});

test('aborts timed-out requests and maps network failure to a safe code', async () => {
  const provider = createGeminiProvider({
    configuration: { ...configuration, timeoutMs: 5 },
    fetchImpl: async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(new Error('private network detail')),
        );
      }),
  });
  await assert.rejects(provider.select(context), { reason: 'timeout' });
  await assert.rejects(
    providerWith(async () => {
      throw new Error('private');
    }).select(context),
    {
      reason: 'provider_error',
    },
  );
});
