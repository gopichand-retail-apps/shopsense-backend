export function buildProductWhere({
  categoryId = null,
  filters = {},
  tokens = [],
} = {}) {
  const clauses = [];
  const parameters = [];
  for (const [field, value] of [
    ['category', categoryId],
    ['color', filters.color],
    ['audience', filters.audience],
    ['product_type', filters.productType],
  ]) {
    if (!value) continue;
    clauses.push(
      field === 'product_type'
        ? '(product_type = ? OR product_type IS NULL)'
        : `${field} = ?`,
    );
    parameters.push(value);
  }
  for (const color of filters.excludedColors ?? []) {
    clauses.push('(color IS NOT NULL AND color <> ?)');
    parameters.push(color);
  }
  appendPriceBounds(filters, clauses, parameters);
  const searchText =
    "lower(name || ' ' || brand || ' ' || description || ' ' || attributes_json || ' ' || match_tags_json)";
  if (shouldSearchTokens({ tokens, categoryId, filters })) {
    clauses.push(
      `(${tokens.map(() => `${searchText} LIKE ? ESCAPE '\\'`).join(' OR ')})`,
    );
    parameters.push(
      ...tokens.map((token) => `%${token.replace(/[\\%_]/g, '\\$&')}%`),
    );
  }
  return {
    sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    parameters,
  };
}

function shouldSearchTokens({ tokens, categoryId, filters }) {
  return (
    tokens.length &&
    !categoryId &&
    !filters.color &&
    !filters.audience &&
    !filters.productType
  );
}

function appendPriceBounds(filters, clauses, parameters) {
  for (const [bound, comparison] of [
    ['minimumPriceCents', '>='],
    ['maximumPriceCents', '<='],
  ]) {
    if (filters[bound] === null || filters[bound] === undefined) continue;
    clauses.push(`price_cents ${comparison} ?`);
    parameters.push(filters[bound]);
  }
}

export function retrieveProducts(database, intent, mapProduct) {
  const { sql, parameters } = buildProductWhere(intent);
  // Filter in SQL first. The bounded shortlist is ranked in the domain service before any provider call.
  return database
    .prepare(`SELECT * FROM products ${sql} ORDER BY display_order LIMIT 2000`)
    .all(...parameters)
    .map(mapProduct);
}

export function catalogPage(
  database,
  { category = null, offset = 0, limit = 24, ids = [] },
  mapProduct,
) {
  const { sql, parameters } = buildProductWhere({ categoryId: category });
  const where = ids.length
    ? `WHERE id IN (${ids.map(() => '?').join(',')})`
    : sql;
  const values = ids.length ? ids : parameters;
  return database
    .prepare(
      `SELECT * FROM products ${where} ORDER BY display_order LIMIT ? OFFSET ?`,
    )
    .all(...values, limit, offset)
    .map(mapProduct);
}
