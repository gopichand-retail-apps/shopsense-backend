import assert from 'node:assert/strict';
import test from 'node:test';
import { aiCapabilities, readAiConfiguration } from './configuration.mjs';

test('AI requires both explicit provider configuration and a server key', () => {
  assert.deepEqual(aiCapabilities(readAiConfiguration({})), {
    available: false,
    provider: 'local',
  });
  assert.equal(
    aiCapabilities(readAiConfiguration({ GEMINI_API_KEY: 'test' })).available,
    false,
  );
  assert.equal(
    aiCapabilities(readAiConfiguration({ SHOPSENSE_AI_PROVIDER: 'gemini' }))
      .available,
    false,
  );
  assert.deepEqual(
    aiCapabilities(
      readAiConfiguration({
        SHOPSENSE_AI_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'test',
      }),
    ),
    { available: true, provider: 'gemini' },
  );
});

test('configuration rejects invalid models, providers, timeouts and unbounded usage', () => {
  for (const environment of [
    { GEMINI_MODEL: '../secret' },
    { SHOPSENSE_AI_PROVIDER: 'unknown' },
    { SHOPSENSE_AI_TIMEOUT_MS: '0' },
    { SHOPSENSE_AI_DAILY_REQUEST_LIMIT: '-1' },
    { SHOPSENSE_AI_MAX_CONCURRENT: '6' },
  ])
    assert.throws(() => readAiConfiguration(environment));
});
