import { createHmac, randomBytes } from 'node:crypto';

function normalizeText(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function inferIntent(query, model) {
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
  return { categoryId: category?.id ?? null, tokens: usefulTokens };
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
  return {
    recommend(query) {
      const intent = inferIntent(query, model);
      const results = repository
        .listProducts(intent.categoryId)
        .map((product) => scoreProduct(product, intent))
        .filter((result) => result.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.product.name.localeCompare(right.product.name),
        )
        .slice(0, model.search.resultLimit)
        .map((result) => ({
          product: { ...result.product, matchTags: undefined },
          matchedDetails: explainMatch(result, intent, model),
        }));
      const queryHash = createHmac('sha256', queryHashKey)
        .update(normalizeText(query))
        .digest('hex');
      repository.recordQuery({
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
      };
    },
  };
}

export { inferIntent, scoreProduct };
