import { randomBytes } from 'node:crypto';
import {
  matchesFilters,
  matchesShoppingNeed,
  refineCatalogIntent,
} from '../catalog/search-query.mjs';
import { locateProduct } from '../catalog/store-layout.mjs';
import {
  createResultSummary,
  explainMatch,
  fingerprintQuery,
  inferIntent,
  scoreProduct,
} from '../recommendation.service.mjs';
import {
  catalogFreshness,
  effectiveAvailability,
  freshAfter,
} from './availability.mjs';

const RANKED_LIMIT = 36;

// Each matched detail links to the stored attribute it came from; other evidence (tags, category) has no index.
export function deriveMatches(attributes, details) {
  return details.map((text) => {
    const index = attributes.indexOf(text);
    return index >= 0
      ? { field: 'attributes', index, text }
      : { field: 'tags', text };
  });
}

function freshness(context) {
  return catalogFreshness({
    status: context.offers.feedStatus(),
    now: context.now(),
    maxAgeMinutes: context.maxAgeMinutes,
  });
}

function present(context, product, locationId) {
  return {
    ...locateProduct(product),
    availability: locationId
      ? effectiveAvailability(product.availability, {
          locationId,
          now: context.now(),
          maxAgeMinutes: context.maxAgeMinutes,
        })
      : null,
  };
}

function rankCandidates(candidates, intent) {
  return candidates
    .filter((product) => matchesFilters(product, intent.filters))
    .filter((product) => matchesShoppingNeed(product, intent))
    .map((product) => scoreProduct(product, intent))
    .filter((result) => result.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.product.name.localeCompare(right.product.name),
    );
}

async function retrieve(context, query, filters = {}) {
  const intent = refineCatalogIntent(
    inferIntent(query, context.model),
    filters,
  );
  if (intent.matchesNone) return { intent, total: 0, ranked: [] };
  const locationId = filters.locationId ?? null;
  const candidates = context.offers.retrieve({
    categoryId: intent.categoryId,
    filters: intent.filters,
    tokens: intent.tokens,
    locationId,
    availableOnly: Boolean(filters.availableOnly && locationId),
    freshAfter: freshAfter(context.now(), context.maxAgeMinutes),
  });
  const ranked = rankCandidates(
    candidates.map((product) => present(context, product, locationId)),
    intent,
  );
  return {
    intent,
    total: ranked.length,
    ranked: ranked.slice(0, RANKED_LIMIT),
  };
}

async function recommend(context, query, filters = {}) {
  const { model } = context;
  const { intent, ranked, total } = await retrieve(context, query, filters);
  const results = ranked.slice(0, model.search.resultLimit).map((result) => ({
    product: { ...result.product, matchTags: undefined },
    matchedDetails: explainMatch(result, intent, model),
  }));
  await context.repository.recordQuery({
    queryHash: fingerprintQuery(query, context.queryHashKey),
    intentCategory: intent.categoryId,
    resultCount: results.length,
  });
  return {
    intentCategory: intent.categoryId,
    resultCount: results.length,
    results,
    summary: createResultSummary(results.length, query, model),
    source: model.copy.localCatalogSource,
    totalMatches: total,
    appliedFilters: intent.filters,
    catalog: freshness(context),
  };
}

async function browse(context, options) {
  const { category = null, ids = [], offset = 0, limit = 24 } = options;
  const locationId = options.locationId ?? null;
  const page = ids.length
    ? context.offers.page({ ids, locationId, offset: 0, limit: ids.length })
    : context.offers.page({ category, locationId, offset, limit });
  const items = page.items.map((product) => ({
    ...present(context, product, locationId),
    matchTags: undefined,
  }));
  const found = new Set(items.map((item) => item.id));
  return {
    items,
    total: page.total,
    unavailableIds: ids.filter((id) => !found.has(id)),
    catalog: freshness(context),
  };
}

export function createOfferDiscovery({
  repository,
  model,
  now = () => new Date(),
  maxAgeMinutes,
  queryHashKey = randomBytes(32),
}) {
  const offers = repository.offers;
  const context = {
    repository,
    offers,
    model,
    now,
    maxAgeMinutes,
    queryHashKey,
  };
  return {
    retrieve: (query, filters) => retrieve(context, query, filters),
    recommend: (query, filters) => recommend(context, query, filters),
    browse: (options = {}) => browse(context, options),
    freshness: () => freshness(context),
    status: () => ({ ...offers.feedStatus(), ...freshness(context) }),
    locations: () => offers.listLocations(),
    hasLocation: (id) => offers.hasLocation(id),
  };
}
