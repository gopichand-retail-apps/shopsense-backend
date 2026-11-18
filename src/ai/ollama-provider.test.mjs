import assert from 'node:assert/strict';
import test from 'node:test';
import { createOllamaProvider } from './ollama-provider.mjs';
import { readAiConfiguration, aiCapabilities } from './configuration.mjs';

const configuration = readAiConfiguration({ SHOPSENSE_AI_PROVIDER: 'ollama' });
const context = {
  query: 'quiet headphones',
  products: [{ id: 'one', attributes: ['Source'], matchTags: [] }],
  resultLimit: 6,
  currency: 'USD',
};
const selection = {
  minimumPriceCents: null,
  maximumPriceCents: null,
  recommendations: [],
};

test('Ollama remains loopback-only, bounded, schema-controlled, and unloads after its response', async () => {
  assert.deepEqual(aiCapabilities(configuration), {
    available: true,
    provider: 'ollama',
  });
  for (const url of [
    'http://example.com',
    'http://127.0.0.1/private',
    'http://user:pass@localhost',
    'https://localhost',
    'http://localhost/?token=bad',
  ]) {
    assert.throws(() => readAiConfiguration({ OLLAMA_BASE_URL: url }));
  }
  const provider = createOllamaProvider({
    configuration,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:11434/api/chat');
      const body = JSON.parse(options.body);
      assert.equal(body.stream, false);
      assert.equal(body.keep_alive, 0);
      assert.equal(body.options.num_ctx, 4096);
      assert.equal(body.options.num_predict, 1024);
      assert.ok(body.format.required.includes('recommendations'));
      return new Response(
        JSON.stringify({
          done: true,
          message: { content: JSON.stringify(selection) },
        }),
      );
    },
  });
  assert.deepEqual(await provider.select(context), selection);
});

test('Ollama maps HTTP, malformed, truncated and timed out requests to safe failures', async () => {
  for (const [response, reason] of [
    [() => new Response('private', { status: 429 }), 'quota'],
    [() => new Response('private', { status: 500 }), 'provider_error'],
    [() => new Response('{}'), 'invalid_response'],
    [() => new Response('{'), 'invalid_response'],
    [
      () => new Response(JSON.stringify({ done: true, message: {} })),
      'invalid_response',
    ],
    [
      () => {
        throw new DOMException('private', 'TimeoutError');
      },
      'timeout',
    ],
    [
      () => {
        throw new Error('private connection details');
      },
      'provider_error',
    ],
  ]) {
    const provider = createOllamaProvider({
      configuration,
      fetchImpl: async () => response(),
    });
    await assert.rejects(provider.select(context), { reason });
  }
});
