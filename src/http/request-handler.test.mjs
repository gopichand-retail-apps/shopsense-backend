import assert from 'node:assert/strict';
import test from 'node:test';
import { handleApiRequest } from './request-handler.mjs';
import { loadModel } from '../server.mjs';

test('converts an unexpected stream failure to a safe response without exposing details', async () => {
  const model = loadModel();
  const response = createResponse();
  const request = {
    headers: {
      origin: model.app.allowedOrigin,
      'x-request-id': 'test-request-42',
    },
    method: 'POST',
    url: '/api/v1/search',
    socket: { remoteAddress: '127.0.0.1' },
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          throw new Error('private stream detail');
        },
      };
    },
  };

  await handleApiRequest({
    request,
    response,
    model,
    repository: {},
    recommendations: {},
    allowedOrigins: [model.app.allowedOrigin],
    rateLimit: () => ({ allowed: true, retryAfterSeconds: 1 }),
  });

  assert.equal(response.status, 500);
  assert.equal(response.headers.get('X-Request-ID'), 'test-request-42');
  assert.equal(
    response.headers.get('Access-Control-Allow-Origin'),
    model.app.allowedOrigin,
  );
  const body = JSON.parse(response.body);
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.equal(body.error.message, model.copy.errors.server);
  assert.equal(body.error.requestId, 'test-request-42');
  assert.equal(response.body.includes('private stream detail'), false);
});

function createResponse() {
  return {
    headers: new Map(),
    status: null,
    body: '',
    setHeader(name, value) {
      this.headers.set(name, value);
    },
    writeHead(status, headers = {}) {
      this.status = status;
      for (const [name, value] of Object.entries(headers))
        this.headers.set(name, value);
    },
    end(body = '') {
      this.body = body;
    },
  };
}
