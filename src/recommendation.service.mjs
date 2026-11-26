import { createHmac, randomBytes } from 'node:crypto';
import {
  matchesFilters,
  parseCatalogQuery,
  refineCatalogIntent,
  expandShoppingNeed,
  matchesShoppingNeed,
} from './catalog/search-query.mjs';

function normalizeText(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function inferIntent(query, model) {
  const filters = parseCatalogQuery(query);
  const normalized = normalizeText(query);
  const tokens = normalized.match(/[a-z0-9]+/g) ?? [];
  const usefulTokens = [
    ...new Set(
      tokens.filter(
        (token) => token.length > 1 && !model.search.stopWords.includes(token),
      ),
    ),
  ];
  const category = model.categories.find((item) => {
    const categoryLabel = model.copy.categories[item.id] ?? item.id;
    const terms = [item.id, categoryLabel, ...(item.aliases ?? [])].map(
      normalizeText,
    );
    return terms.some((term) => normalized.includes(term));
  });
  return expandShoppingNeed(normalized, {
    categoryId: filters.categoryId ?? category?.id ?? null,
    tokens: usefulTokens,
    filters,
  });
}

function scoreProduct(product, intent) {
  const searchableText = normalizeText(
    [
      product.name,
      product.brand,
      product.category,
      product.description,
      ...product.attributes,
      ...product.matchTags,
    ].join(' '),
  );
  const matchedTokens = intent.tokens.filter((token) =>
    searchableText.includes(token),
  );
  const tagHits = intent.tokens.filter((token) =>
    product.matchTags.some(
      (tag) =>
        normalizeText(tag).includes(token) ||
        token.includes(normalizeText(tag)),
    ),
  );
  const attributeMatches = product.attributes.filter((attribute) =>
    intent.tokens.some((token) => normalizeText(attribute).includes(token)),
  );
  const categoryMatch = intent.categoryId === product.category;
  const score =
    matchedTokens.length +
    tagHits.length * 2 +
    attributeMatches.length * 2 +
    Number(categoryMatch) * 4;
  return { product, score, matchedTokens, attributeMatches, categoryMatch };
}

function explainMatch(result, intent, model) {
  const matchedTags = result.product.matchTags.filter((tag) =>
    intent.tokens.some(
      (token) =>
        normalizeText(tag).includes(token) ||
        token.includes(normalizeText(tag)),
    ),
  );
  const details = [
    ...new Set([...result.attributeMatches, ...matchedTags]),
  ].slice(0, 3);
  if (details.length) return details;
  const categoryLabel = model.categories.find(
    (item) => item.id === result.product.category,
  )?.label;
  return categoryLabel ? [categoryLabel] : [];
}

function createResultSummary(count, query, model) {
  const template = count ? model.copy.resultsFound : model.copy.noResultsFor;
  return template
    .replace('{count}', String(count))
    .replace('{query}', query.trim());
}

export function createRecommendationService({
  repository,
  model,
  queryHashKey = randomBytes(32),
}) {
  async function retrieve(query, filters) {
    const intent = refineCatalogIntent(inferIntent(query, model), filters);
    const products = await retrieveCandidates(repository, intent);
    const ranked = products
      .filter((product) => matchesFilters(product, intent.filters))
      .filter((product) => matchesShoppingNeed(product, intent))
      .map((product) => scoreProduct(product, intent))
      .filter((result) => result.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.product.name.localeCompare(right.product.name),
      );
    return { intent, total: ranked.length, ranked: ranked.slice(0, 36) };
  }
  return {
    retrieve,
    async recommend(query, filters) {
      const { intent, ranked, total } = await retrieve(query, filters);
      const results = ranked
        .slice(0, model.search.resultLimit)
        .map((result) => ({
          product: { ...result.product, matchTags: undefined },
          matchedDetails: explainMatch(result, intent, model),
        }));
      const queryHash = fingerprintQuery(query, queryHashKey);
      await repository.recordQuery({
        queryHash,
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
      };
    },
  };
}

async function retrieveCandidates(repository, intent) {
  if (intent.matchesNone) return [];
  return repository.retrieveProducts
    ? repository.retrieveProducts(intent)
    : repository.listProducts(intent.categoryId);
}

function fingerprintQuery(query, key) {
  return createHmac('sha256', key).update(normalizeText(query)).digest('hex');
}

export {
  createResultSummary,
  explainMatch,
  fingerprintQuery,
  inferIntent,
  scoreProduct,
};
