import { z } from 'zod';
import { deriveMatches } from '../offers/offer-discovery.mjs';
import { apiFailure } from './errors.mjs';
import { readJsonBody } from './json.mjs';
import { searchFilterShape, searchQuery } from './search-schema.mjs';

const locationId = z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/);
const searchSchema = z
  .object({
    query: searchQuery,
    useAi: z.boolean().optional(),
    location: locationId.optional(),
    filters: z
      .object({ ...searchFilterShape, availableOnly: z.boolean().optional() })
      .strict()
      .optional(),
  })
  .strict();
const catalogSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100),
  offset: z.coerce.number().int().min(0).max(1_000_000),
  ids: z.array(z.string().min(1).max(80)).max(50),
  location: locationId.optional(),
  category: z.string().min(1).max(80).optional(),
});

const fail = {
  unsupported: ({ model, requestId }) =>
    apiFailure(
      501,
      'OFFERS_NOT_SUPPORTED',
      model.copy.errors.offersUnavailable,
      requestId,
    ),
  location: ({ model, requestId }) =>
    apiFailure(
      400,
      'INVALID_LOCATION',
      model.copy.errors.invalidLocation,
      requestId,
    ),
  search: ({ model, requestId }) =>
    apiFailure(
      400,
      'INVALID_SEARCH',
      model.copy.errors.invalidSearch,
      requestId,
    ),
  request: ({ model, requestId }) =>
    apiFailure(
      400,
      'INVALID_REQUEST',
      model.copy.errors.invalidRequest,
      requestId,
    ),
};
const ok = (data) => ({ status: 200, body: { data } });

// The offer projection exists only in the SQLite profile; other profiles answer a deliberate 501.
const requireOffers = (handler) => (context) =>
  context.offerDiscovery ? handler(context) : fail.unsupported(context);

function handleLocations({ offerDiscovery }) {
  return ok({ locations: offerDiscovery.locations() });
}

function handleFeedStatus({ offerDiscovery }) {
  const status = offerDiscovery.status();
  return ok({
    state: status.state,
    asOf: status.asOf,
    generatedAt: status.generatedAt,
    maxAgeMinutes: status.maxAgeMinutes,
    offerCount: status.offerCount,
    withdrawnCount: status.withdrawnCount,
    locationCount: status.locationCount,
  });
}

async function handleCatalog(context) {
  const { model, offerDiscovery, url } = context;
  const parsed = catalogSchema.safeParse({
    limit: url.searchParams.get('limit') ?? 24,
    offset: url.searchParams.get('offset') ?? 0,
    ids: url.searchParams.get('ids')?.split(',') ?? [],
    location: url.searchParams.get('location') ?? undefined,
    category: url.searchParams.get('category') ?? undefined,
  });
  if (!parsed.success) return fail.request(context);
  const { category, location, ...page } = parsed.data;
  if (category && !model.categories.some((item) => item.id === category))
    return fail.request(context);
  if (location && !offerDiscovery.hasLocation(location))
    return fail.location(context);
  return ok(
    await offerDiscovery.browse({
      ...page,
      category,
      locationId: location ?? null,
    }),
  );
}

async function handleSearch(context) {
  const { model, offerDiscovery, offerRecommendations, request, requestId } =
    context;
  const parsed = searchSchema.safeParse(
    await readJsonBody(request, model.search.maximumBodyBytes),
  );
  if (
    !parsed.success ||
    parsed.data.query.length > model.search.maximumQueryCharacters
  )
    return fail.search(context);
  const { query, useAi, location, filters = {} } = parsed.data;
  if (filters.availableOnly && !location) return fail.search(context);
  if (location && !offerDiscovery.hasLocation(location))
    return fail.location(context);
  const result = await offerRecommendations.recommend(query, {
    useAi,
    requestId,
    filters: { ...filters, locationId: location ?? null },
  });
  return ok({
    ...result,
    catalog: result.catalog ?? offerDiscovery.freshness(),
    results: result.results.map((item) => ({
      ...item,
      matches: deriveMatches(item.product.attributes, item.matchedDetails),
    })),
  });
}

export const offerRoutes = [
  ['GET /api/v2/locations', requireOffers(handleLocations)],
  ['GET /api/v2/feed-status', requireOffers(handleFeedStatus)],
  ['GET /api/v2/catalog', requireOffers(handleCatalog)],
  ['POST /api/v2/search', requireOffers(handleSearch)],
];
