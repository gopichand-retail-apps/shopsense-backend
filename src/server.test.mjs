import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import {
  createApiServer,
  loadModel,
  loadModelEnvelope,
  routeTemplate,
} from './server.mjs';

test('route templates retain known routes and hide unknown path segments', () => {
  assert.equal(routeTemplate('/api/v1/health'), '/api/v1/health');
  assert.equal(routeTemplate('/api/v1/catalog'), '/api/v1/catalog');
  assert.equal(routeTemplate('/api/v1/search'), '/api/v1/search');
  assert.equal(routeTemplate('/api/v1/feedback'), '/api/v1/feedback');
  assert.equal(routeTemplate('/private/person@example.invalid'), '/unmatched');
});

test('rejects invalid origin and rate-limit configuration before serving requests', () => {
  assert.throws(
    () =>
      createApiServer({
        databasePath: ':memory:',
        allowedOrigins: ['not-an-origin'],
      }),
    /Invalid URL/,
  );

  const previousLimit = process.env.API_RATE_LIMIT_MAX;
  process.env.API_RATE_LIMIT_MAX = 'not-a-number';
  try {
    assert.throws(
      () => createApiServer({ databasePath: ':memory:' }),
      RangeError,
    );
  } finally {
    if (previousLimit === undefined) delete process.env.API_RATE_LIMIT_MAX;
    else process.env.API_RATE_LIMIT_MAX = previousLimit;
  }
});

async function startTestServer(t, options = {}) {
  const api = createApiServer({ databasePath: ':memory:', ...options });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(() => api.close());
  return `http://127.0.0.1:${api.server.address().port}`;
}

test('health reports service and SQLite readiness', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/api/v1/health`);
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.data.service, 'shopsense-api');
  assert.equal(result.data.storage, 'sqlite');
  assert.ok(response.headers.get('x-request-id'));
  assert.ok(response.headers.get('x-trace-id'));
});

test('version reports the backend package release', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/api/v1/version`);
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(result.data, { service: 'shopsense-api', version: '1.0.0' });
});

test('validates request IDs and trace context before echoing them', async (t) => {
  const baseUrl = await startTestServer(t);
  const traceparent = '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01';
  const validResponse = await fetch(`${baseUrl}/api/v1/health`, {
    headers: { 'X-Request-ID': 'client-request.123', traceparent },
  });
  const invalidResponse = await fetch(`${baseUrl}/api/v1/health`, {
    headers: { 'X-Request-ID': 'invalid request id' },
  });

  assert.equal(validResponse.headers.get('x-request-id'), 'client-request.123');
  assert.equal(
    validResponse.headers.get('x-trace-id'),
    '0123456789abcdef0123456789abcdef',
  );
  assert.match(
    invalidResponse.headers.get('x-request-id') ?? '',
    /^[0-9a-f-]{36}$/i,
  );
  assert.match(
    invalidResponse.headers.get('x-trace-id') ?? '',
    /^[a-f0-9]{32}$/,
  );
});

test('uses the single allowed origin when the origin list is omitted', async (t) => {
  const model = loadModelEnvelope();
  delete model.data.app.allowedOrigins;
  const baseUrl = await startTestServer(t, { model });
  const response = await fetch(`${baseUrl}/api/v1/health`, {
    headers: { Origin: model.data.app.allowedOrigin },
  });

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    model.data.app.allowedOrigin,
  );
});

test('uses an explicit environment origin list when configured', async (t) => {
  const model = loadModel();
  const originalOrigins = process.env.SHOPSENSE_ALLOWED_ORIGINS;
  process.env.SHOPSENSE_ALLOWED_ORIGINS = 'https://shopsense.example';
  let baseUrl;
  try {
    baseUrl = await startTestServer(t);
  } finally {
    if (originalOrigins === undefined)
      delete process.env.SHOPSENSE_ALLOWED_ORIGINS;
    else process.env.SHOPSENSE_ALLOWED_ORIGINS = originalOrigins;
  }
  const allowedResponse = await fetch(`${baseUrl}/api/v1/health`, {
    headers: { Origin: 'https://shopsense.example' },
  });
  const deniedResponse = await fetch(`${baseUrl}/api/v1/health`, {
    headers: { Origin: model.app.allowedOrigin },
  });

  assert.equal(allowedResponse.status, 200);
  assert.equal(
    allowedResponse.headers.get('access-control-allow-origin'),
    'https://shopsense.example',
  );
  assert.equal(deniedResponse.status, 403);
});

test('catalog is seeded from the shared public model', async (t) => {
  const baseUrl = await startTestServer(t);
  const [response, model] = await Promise.all([
    fetch(`${baseUrl}/api/v1/catalog`),
    Promise.resolve(loadModel()),
  ]);
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.data.length, model.seed.products.length);
  assert.equal(result.data[0].id, model.seed.products[0].id);
});

test('search validates input and returns catalog-grounded results', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/api/v1/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'quiet headphones for focused work' }),
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.data.results[0].product.id, 'studio-headphones');
  assert.ok(result.data.results[0].matchedDetails.length > 0);
  assert.ok(response.headers.get('x-request-id'));
});

test('malformed search input returns a safe error envelope', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/api/v1/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'x' }),
  });
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.error.code, 'INVALID_SEARCH');
  assert.equal(result.error.requestId, response.headers.get('x-request-id'));
});

test('rejects unrecognized search and feedback request fields', async (t) => {
  const baseUrl = await startTestServer(t);
  const search = await fetch(`${baseUrl}/api/v1/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'quiet headphones', debug: true }),
  });
  const feedback = await fetch(`${baseUrl}/api/v1/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productId: 'studio-headphones',
      helpful: true,
      userId: 'client-controlled',
    }),
  });

  assert.equal(search.status, 400);
  assert.equal((await search.json()).error.code, 'INVALID_SEARCH');
  assert.equal(feedback.status, 400);
  assert.equal((await feedback.json()).error.code, 'INVALID_FEEDBACK');
});

test('enforces a model-specific search character limit', async (t) => {
  const model = loadModelEnvelope();
  model.data.search.maximumQueryCharacters = 3;
  const baseUrl = await startTestServer(t, { model });
  const response = await fetch(`${baseUrl}/api/v1/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'home' }),
  });
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.error.code, 'INVALID_SEARCH');
});

test('invalid JSON and oversized bodies return safe error envelopes', async (t) => {
  const baseUrl = await startTestServer(t);
  const invalidJson = await fetch(`${baseUrl}/api/v1/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  const invalidJsonResult = await invalidJson.json();
  const oversized = await fetch(`${baseUrl}/api/v1/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'x'.repeat(9000) }),
  });
  const oversizedResult = await oversized.json();

  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJsonResult.error.code, 'INVALID_JSON');
  assert.equal(oversized.status, 413);
  assert.equal(oversizedResult.error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(
    oversizedResult.error.requestId,
    oversized.headers.get('x-request-id'),
  );
});

test('catalog rejects categories outside the public model', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/api/v1/catalog?category=unlisted`);
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.error.code, 'INVALID_CATEGORY');
});

test('unapproved browser origins are rejected', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/api/v1/catalog`, {
    headers: { Origin: 'https://unapproved.example' },
  });
  const result = await response.json();

  assert.equal(response.status, 403);
  assert.equal(result.error.code, 'ORIGIN_NOT_ALLOWED');
});

test('preflight permits feedback from both explicit local frontend origins', async (t) => {
  const baseUrl = await startTestServer(t);
  const allowedOrigins = loadModel().app.allowedOrigins;

  for (const origin of allowedOrigins) {
    const response = await fetch(`${baseUrl}/api/v1/feedback`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers':
          'content-type,x-request-id,traceparent',
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.match(
      response.headers.get('access-control-allow-methods') ?? '',
      /POST/,
    );
    assert.match(
      response.headers.get('access-control-allow-headers') ?? '',
      /x-request-id/i,
    );
    assert.match(
      response.headers.get('access-control-allow-headers') ?? '',
      /traceparent/i,
    );
  }
});

test('preflight without an origin returns no content and no allow-origin header', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/api/v1/health`, {
    method: 'OPTIONS',
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('feedback persists only for a catalog product', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/api/v1/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: 'studio-headphones', helpful: true }),
  });
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(result.data, { accepted: true });
});

test('feedback rejects invalid input and unknown products', async (t) => {
  const baseUrl = await startTestServer(t);
  const invalidResponse = await fetch(`${baseUrl}/api/v1/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: 'studio-headphones', helpful: 'yes' }),
  });
  const invalidResult = await invalidResponse.json();
  const missingResponse = await fetch(`${baseUrl}/api/v1/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: 'missing-product', helpful: true }),
  });
  const missingResult = await missingResponse.json();

  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidResult.error.code, 'INVALID_FEEDBACK');
  assert.equal(missingResponse.status, 404);
  assert.equal(missingResult.error.code, 'PRODUCT_NOT_FOUND');
});

test('unknown API routes return a safe not-found envelope', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/private/person@example.invalid`);
  const result = await response.json();

  assert.equal(response.status, 404);
  assert.equal(result.error.code, 'NOT_FOUND');
});

test('API rate limiting returns retry metadata', async (t) => {
  const originalLimit = process.env.API_RATE_LIMIT_MAX;
  process.env.API_RATE_LIMIT_MAX = '1';
  let baseUrl;
  try {
    baseUrl = await startTestServer(t);
  } finally {
    if (originalLimit === undefined) delete process.env.API_RATE_LIMIT_MAX;
    else process.env.API_RATE_LIMIT_MAX = originalLimit;
  }
  const firstResponse = await fetch(`${baseUrl}/api/v1/catalog`);
  const limitedResponse = await fetch(`${baseUrl}/api/v1/catalog`);
  const result = await limitedResponse.json();

  assert.equal(firstResponse.status, 200);
  assert.equal(limitedResponse.status, 429);
  assert.equal(result.error.code, 'RATE_LIMITED');
  assert.match(limitedResponse.headers.get('retry-after') ?? '', /^[0-9]+$/);
});
