import assert from 'node:assert/strict';
import test from 'node:test';
import { apiFailure, mapApiError } from './errors.mjs';
import { loadModel } from '../server.mjs';

const model = loadModel();

test('creates a consistent API failure envelope', () => {
  assert.deepEqual(
    apiFailure(403, 'ORIGIN_NOT_ALLOWED', 'Denied', 'request-1'),
    {
      status: 403,
      errorCode: 'ORIGIN_NOT_ALLOWED',
      body: {
        error: {
          code: 'ORIGIN_NOT_ALLOWED',
          message: 'Denied',
          requestId: 'request-1',
        },
      },
    },
  );
});

test('maps malformed, oversized, and unexpected errors to safe copy', () => {
  const invalidJson = Object.assign(new Error('raw request detail'), {
    status: 400,
  });
  const tooLarge = Object.assign(new Error('raw payload detail'), {
    status: 413,
  });
  const internal = new Error('database connection detail');

  assert.equal(
    mapApiError(invalidJson, model, 'request-1').body.error.code,
    'INVALID_JSON',
  );
  assert.equal(
    mapApiError(invalidJson, model, 'request-1').body.error.message,
    model.copy.errors.invalidRequest,
  );
  assert.equal(
    mapApiError(tooLarge, model, 'request-2').body.error.code,
    'PAYLOAD_TOO_LARGE',
  );
  assert.equal(
    mapApiError(tooLarge, model, 'request-2').body.error.message,
    model.copy.errors.payloadTooLarge,
  );
  assert.equal(
    mapApiError(internal, model, 'request-3').body.error.code,
    'INTERNAL_ERROR',
  );
  assert.equal(
    mapApiError(internal, model, 'request-3').body.error.message,
    model.copy.errors.server,
  );
});
