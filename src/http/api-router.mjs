import { z } from 'zod';
import { apiFailure } from './errors.mjs';
import { readJsonBody } from './json.mjs';
import { setCorsHeaders } from './request-metadata.mjs';
import { APP_VERSION } from '../app-version.mjs';
import { storeLayout } from '../catalog/store-layout.mjs';
import { offerRoutes } from './offers-router.mjs';
import { searchFilterShape, searchQuery } from './search-schema.mjs';

const searchSchema = z
  .object({
    query: searchQuery,
    useAi: z.boolean().optional(),
    filters: z.object(searchFilterShape).strict().optional(),
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
  [
    'GET /api/v1/store-layout',
    () => ({ status: 200, body: { data: storeLayout } }),
  ],
  ...offerRoutes,
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

async function handleHealth({ recommendations, repository }) {
  return {
    status: 200,
    body: {
      data: {
        status: 'ok',
        service: 'shopsense-api',
        storage: repository.storage,
        catalogCount: await repository.countProducts(),
        ai: recommendations.capabilities,
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

async function handleCatalog({ model, repository, requestId, url }) {
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
  const pagination = parseCatalogPage(url);
  if (!pagination)
    return apiFailure(
      400,
      'INVALID_CATEGORY',
      model.copy.errors.invalidRequest,
      requestId,
    );
  return {
    status: 200,
    body: { data: await repository.catalogPage({ category, ...pagination }) },
  };
}

function parseCatalogPage(url) {
  const parsed = z
    .object({
      limit: z.coerce.number().int().min(1).max(100),
      offset: z.coerce.number().int().min(0).max(1_000_000),
      ids: z.array(z.string().min(1).max(80)).max(50),
    })
    .safeParse({
      limit: url.searchParams.get('limit') ?? 24,
      offset: url.searchParams.get('offset') ?? 0,
      ids: url.searchParams.get('ids')?.split(',') ?? [],
    });
  return parsed.success ? parsed.data : null;
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
    body: {
      data: await recommendations.recommend(parsed.data.query, {
        useAi: parsed.data.useAi,
        filters: parsed.data.filters,
        requestId,
      }),
    },
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
  if (!(await repository.recordFeedback(parsed.data))) {
    return apiFailure(
      404,
      'PRODUCT_NOT_FOUND',
      model.copy.errors.notFound,
      requestId,
    );
  }
  return { status: 201, body: { data: { accepted: true } } };
}
