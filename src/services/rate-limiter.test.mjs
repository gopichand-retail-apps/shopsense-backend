import assert from 'node:assert/strict';
import test from 'node:test';
import { createRateLimiter } from './rate-limiter.mjs';

test('limits a key within a fixed window and resets it at the boundary', () => {
  let timestamp = 0;
  const consume = createRateLimiter({
    limit: 2,
    windowMs: 1000,
    now: () => timestamp,
  });

  assert.equal(consume('synthetic-client').allowed, true);
  assert.equal(consume('synthetic-client').allowed, true);
  assert.deepEqual(consume('synthetic-client'), {
    allowed: false,
    retryAfterSeconds: 1,
  });

  timestamp = 1000;
  assert.equal(consume('synthetic-client').allowed, true);
});

test('rejects invalid limits and window durations', () => {
  assert.throws(
    () => createRateLimiter({ limit: 0, windowMs: 1000 }),
    RangeError,
  );
  assert.throws(() => createRateLimiter({ limit: 1, windowMs: 0 }), RangeError);
});

test('evicts expired client windows after the map exceeds its bound', () => {
  let timestamp = 0;
  const consume = createRateLimiter({
    limit: 1,
    windowMs: 1000,
    now: () => timestamp,
  });
  for (let index = 0; index < 10_001; index += 1)
    consume(`synthetic-client-${index}`);

  timestamp = 1000;
  consume('new-synthetic-client');

  assert.equal(consume('synthetic-client-0').allowed, true);
});
