import { z } from 'zod';
import { apiFailure } from './errors.mjs';
import { readJsonBody } from './json.mjs';
import { setCorsHeaders } from './request-metadata.mjs';
import { APP_VERSION } from '../app-version.mjs';

const searchSchema = z
  .object({
    query: z.string().trim().min(3).max(240),
  })
  .strict();
const feedbackSchema = z
  .object({
    productId: z.string().min(1).max(80),
    helpful: z.boolean(),
  })
  .strict();

const handlers = new Map([
  ['GET /api/v1/health', handleHealth],
  ['GET /api/v1/version', handleVersion],
  ['GET /api/v1/catalog', handleCatalog],
  ['POST /api/v1/search', handleSearch],
  ['POST /api/v1/feedback', handleFeedback],
]);

export async function routeApiRequest(context) {
  const {
    request,
    response,
    origin,
    allowedOrigins,
    model,
    requestId,
    pathname,
  } = context;
  if (origin && !allowedOrigins.includes(origin)) {
    return apiFailure(
      403,
      'ORIGIN_NOT_ALLOWED',
      model.copy.errors.originNotAllowed,
      requestId,
    );
  }
  if (origin) setCorsHeaders(response, origin);
  if (request.method === 'OPTIONS') return { status: 204 };

  if (pathname !== '/api/v1/health' && pathname !== '/api/v1/version') {
    const clientKey = request.socket.remoteAddress ?? 'unknown';
    const limitResult = context.rateLimit(clientKey);
    if (!limitResult.allowed) {
      response.setHeader('Retry-After', String(limitResult.retryAfterSeconds));
      return apiFailure(
        429,
        'RATE_LIMITED',
        model.copy.errors.rateLimited,
        requestId,
      );
    }
  }

  const handler = handlers.get(`${request.method} ${pathname}`);
  if (!handler)
    return apiFailure(404, 'NOT_FOUND', model.copy.errors.notFound, requestId);
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  return handler({ ...context, url });
}

function handleHealth() {
  return {
    status: 200,
    body: {
      data: {
        status: 'ok',
        service: 'shopsense-api',
        storage: 'sqlite',
      },
    },
  };
}

function handleVersion() {
  return {
    status: 200,
    body: { data: { service: 'shopsense-api', version: APP_VERSION } },
  };
}

function handleCatalog({ model, repository, requestId, url }) {
  const category = url.searchParams.get('category');
  const validCategory =
    !category || model.categories.some((item) => item.id === category);
  if (!validCategory) {
    return apiFailure(
      400,
      'INVALID_CATEGORY',
      model.copy.errors.invalidRequest,
      requestId,
    );
  }
  return { status: 200, body: { data: repository.listProducts(category) } };
}

async function handleSearch({ model, recommendations, request, requestId }) {
  const body = await readJsonBody(request, model.search.maximumBodyBytes);
  const parsed = searchSchema.safeParse(body);
  if (
    !parsed.success ||
    parsed.data.query.length > model.search.maximumQueryCharacters
  ) {
    return apiFailure(
      400,
      'INVALID_SEARCH',
      model.copy.errors.invalidSearch,
      requestId,
    );
  }
  return {
    status: 200,
    body: { data: recommendations.recommend(parsed.data.query) },
  };
}

async function handleFeedback({ model, repository, request, requestId }) {
  const body = await readJsonBody(request, model.search.maximumBodyBytes);
  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) {
    return apiFailure(
      400,
      'INVALID_FEEDBACK',
      model.copy.errors.invalidRequest,
      requestId,
    );
  }
  if (!repository.recordFeedback(parsed.data)) {
    return apiFailure(
      404,
      'PRODUCT_NOT_FOUND',
      model.copy.errors.notFound,
      requestId,
    );
  }
  return { status: 201, body: { data: { accepted: true } } };
}
