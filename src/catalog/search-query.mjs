export const colors = ['black', 'white', 'navy', 'red', 'green', 'blue'];
const types = [
  ['earbuds', 'audio', ['earbuds', 'earphones', 'airpods']],
  ['headphones', 'audio', ['headphones', 'headset']],
  ['shirt', 'apparel', ['shirt', 'shirts', 't-shirt', 't-shirts']],
  ['pants', 'apparel', ['pants', 'pant', 'trousers']],
  ['dress', 'apparel', ['dress', 'dresses', 'gown', 'kurta', 'tunic']],
  ['shoes', 'apparel', ['shoes', 'sneakers', 'footwear']],
  ['bottle', 'outdoors', ['bottle', 'bottles', 'flask']],
  ['mug', 'home', ['mug', 'mugs', 'coffee cup', 'coffee cups']],
  ['sunglasses', 'accessories', ['sunglasses', 'shades']],
  ['backpack', 'bags', ['backpack', 'backpacks', 'daypack', 'rucksack']],
];
const shoppingNeeds = [
  {
    pattern: /\b(?:wedding|formal\s+(?:event|occasion|outfit|clothing))\b/,
    feature: /\b(?:wedding|formal\s+(?:event|occasion|outfit|clothing))\b/,
    categoryId: 'apparel',
    productTypes: ['dress', 'shirt'],
    evidence: ['occasion', 'formal', 'wedding'],
  },
  {
    pattern:
      /\b(?:drink|drinks|beverage|beverages|water|coffee|tea|bottle|flask|mug|cup)\b.*\bcold\b|\bcold\b.*\b(?:drink|drinks|beverage|beverages|water|coffee|tea|bottle|flask|mug|cup)\b/,
    feature: /\bcold\b/,
    categoryId: 'outdoors',
    compatibleCategories: ['outdoors', 'home'],
    productTypes: ['bottle', 'mug'],
    evidence: ['insulat'],
  },
  {
    pattern:
      /\b(?:block\s+out\s+noise|noise[ -]cancell(?:ing|ation)|reduce\s+noise|noise\s+reduction)\b/,
    feature:
      /\b(?:block\s+out\s+noise|noise[ -]cancell(?:ing|ation)|reduce\s+noise|noise\s+reduction)\b/,
    excludeWhenNegated: true,
    categoryId: 'audio',
    productTypes: ['headphones', 'earbuds'],
    evidence: [
      'noise-cancelling',
      'noise cancelling',
      'noise cancellation',
      'noise reduction',
    ],
  },
];

function includesTerm(text, term) {
  return new RegExp(`\\b${term}\\b`, 'i').test(text);
}

export function parseCatalogQuery(query) {
  const text = query.toLowerCase().replace(/[’']/g, '');
  const excludedColors = colors.filter((color) =>
    new RegExp(`\\b(?:not|no|without|except|excluding)\\s+${color}\\b`).test(
      text,
    ),
  );
  const color =
    colors.find(
      (value) => includesTerm(text, value) && !excludedColors.includes(value),
    ) ?? null;
  const audience =
    [
      ['kids', ['kids', 'kid', 'children', 'child', 'boys', 'girls']],
      ['women', ['women', 'woman', 'womens', 'ladies', 'female']],
      ['men', ['men', 'man', 'mens', 'male']],
    ].find(([, aliases]) =>
      aliases.some((alias) => includesTerm(text, alias)),
    )?.[0] ?? null;
  const type = types.find(([, , aliases]) =>
    aliases.some((alias) => includesTerm(text, alias)),
  );
  return {
    color,
    audience,
    productType: type?.[0] ?? null,
    categoryId: type?.[1] ?? null,
    excludedColors,
    ...priceBounds(text),
  };
}

function priceBounds(text) {
  let minimumPriceCents = null;
  let maximumPriceCents = null;
  const pattern =
    /\b(under|below|less than|up to|at most|over|above|at least)\s*\$?\s*(\d+(?:\.\d{1,2})?)\b/g;
  for (const [, operator, amount] of text.matchAll(pattern)) {
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(cents)) continue;
    if (
      ['under', 'below', 'less than', 'up to', 'at most'].includes(operator)
    ) {
      const upper =
        cents - Number(['under', 'below', 'less than'].includes(operator));
      maximumPriceCents = Math.min(maximumPriceCents ?? Infinity, upper);
    } else {
      const lower = cents + Number(operator !== 'at least');
      minimumPriceCents = Math.max(minimumPriceCents ?? 0, lower);
    }
  }
  return { minimumPriceCents, maximumPriceCents };
}

export function matchesFilters(product, filters) {
  return (
    (!filters.color || product.color === filters.color) &&
    (!filters.audience || product.audience === filters.audience) &&
    (!filters.productType ||
      (product.productType ?? parseCatalogQuery(product.name).productType) ===
        filters.productType) &&
    !filters.excludedColors.includes(product.color) &&
    (!filters.excludedColors.length || Boolean(product.color)) &&
    (filters.minimumPriceCents === null ||
      product.priceCents >= filters.minimumPriceCents) &&
    (filters.maximumPriceCents === null ||
      product.priceCents <= filters.maximumPriceCents)
  );
}

export function refineCatalogIntent(intent, refinements = {}) {
  const filters = { ...intent.filters };
  let matchesNone = false;
  for (const name of ['audience', 'color']) {
    if (!refinements[name]) continue;
    if (filters[name] && filters[name] !== refinements[name])
      matchesNone = true;
    filters[name] = refinements[name];
  }
  if (refinements.maximumPriceCents !== undefined) {
    filters.maximumPriceCents = Math.min(
      filters.maximumPriceCents ?? Infinity,
      refinements.maximumPriceCents,
    );
  }
  if (filters.excludedColors.includes(filters.color)) matchesNone = true;
  if (
    filters.minimumPriceCents !== null &&
    filters.maximumPriceCents !== null &&
    filters.minimumPriceCents > filters.maximumPriceCents
  )
    matchesNone = true;
  return { ...intent, filters, matchesNone };
}

export function expandShoppingNeed(query, intent) {
  const requirements = shoppingNeeds
    .filter(
      (need) =>
        need.pattern.test(query) &&
        (!intent.categoryId ||
          (need.compatibleCategories ?? [need.categoryId]).includes(
            intent.categoryId,
          )),
    )
    .map((need) => ({ ...need, negated: isNegatedNeed(query, need) }))
    .filter((need) => !need.negated || need.excludeWhenNegated);
  return {
    ...intent,
    categoryId: intent.categoryId ?? requirements[0]?.categoryId ?? null,
    tokens: [
      ...new Set([
        ...intent.tokens,
        ...requirements.flatMap((need) => need.evidence),
      ]),
    ],
    requirements,
  };
}

export function matchesShoppingNeed(product, intent) {
  const productType =
    product.productType ?? parseCatalogQuery(product.name).productType;
  const evidence = [
    product.name,
    product.description,
    ...product.attributes,
    ...product.matchTags,
  ]
    .join(' ')
    .toLowerCase();
  return (intent.requirements ?? []).every(
    (need) =>
      need.productTypes.includes(productType) &&
      need.evidence.some((term) => evidence.includes(term)) !== need.negated,
  );
}

function isNegatedNeed(query, need) {
  const feature = need.feature.exec(query);
  const boundary = /\b(?:but|however)\b|[.;,!?]/;
  const prefix = query.slice(0, feature.index).split(boundary).at(-1);
  const suffix = query.slice(feature.index + feature[0].length);
  const negation =
    /\b(?:no|not|without|except|excluding|don['’]?t|doesn['’]?t|do\s+not)\b(?:[\s-]+\w+){0,5}[\s-]*$/;
  return (
    (negation.test(prefix) && !/\bnot\s+only\b/.test(prefix)) ||
    /^\s+(?:is\s+)?not\s+(?:needed|required|necessary)\b/.test(suffix)
  );
}
