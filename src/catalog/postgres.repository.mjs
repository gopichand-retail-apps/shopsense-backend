import { randomUUID } from 'node:crypto';
import { buildProductWhere } from './sqlite-search.mjs';

export function createPostgresRepository({ pool, organizationId }) {
  if (!/^[a-f0-9-]{36}$/i.test(organizationId))
    throw new Error('A valid organization UUID is required.');
  const context = { pool, organizationId };
  return {
    storage: 'postgres',
    catalogPage: (options) => page(context, options),
    retrieveProducts: (intent) => retrieve(context, intent),
    getProduct: async (id) =>
      (await page(context, { ids: [id], limit: 1 }))[0] ?? null,
    countProducts: async () =>
      Number(
        (
          await pool.query(
            'SELECT COUNT(*) AS total FROM products WHERE organization_id = $1',
            [organizationId],
          )
        ).rows[0].total,
      ),
    recordQuery: (record) =>
      pool.query(
        `INSERT INTO query_sessions
      (id, organization_id, query_hash, intent_category, result_count) VALUES ($1,$2,$3,$4,$5)`,
        [
          randomUUID(),
          organizationId,
          record.queryHash,
          record.intentCategory,
          record.resultCount,
        ],
      ),
    recordFeedback: (record) => feedback(context, record),
    reserveAiRequest: (day, limit) => reserve(context, day, limit),
    close: () => pool.end(),
  };
}

function mapProduct(row) {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    priceCents: row.price_cents,
    description: row.description,
    imageUrl: row.image_url,
    imageAlt: row.image_alt,
    attributes: row.attributes_json,
    matchTags: row.match_tags_json,
    ...(row.color ? { color: row.color } : {}),
    ...(row.audience ? { audience: row.audience } : {}),
    ...(row.product_type ? { productType: row.product_type } : {}),
  };
}

async function page(
  { pool, organizationId },
  { category = null, offset = 0, limit = 24, ids = [] } = {},
) {
  const parameters = [organizationId];
  let condition = '';
  if (category) {
    parameters.push(category);
    condition += ' AND category = $2';
  }
  if (ids.length) {
    parameters.push(ids);
    condition += ` AND id = ANY($${parameters.length}::text[])`;
  }
  parameters.push(limit, offset);
  const result = await pool.query(
    `SELECT * FROM products WHERE organization_id = $1 ${condition}
    ORDER BY display_order LIMIT $${parameters.length - 1} OFFSET $${parameters.length}`,
    parameters,
  );
  return result.rows.map(mapProduct);
}

async function retrieve({ pool, organizationId }, intent) {
  const where = buildProductWhere({ ...intent, tokens: [] });
  const parameters = [organizationId, ...where.parameters];
  let position = 1;
  let condition = where.sql
    .replace(/^WHERE /, 'AND ')
    .replace(/\?/g, () => `$${++position}`);
  if (
    intent.tokens.length &&
    !intent.categoryId &&
    !intent.filters.color &&
    !intent.filters.audience &&
    !intent.filters.productType
  ) {
    const query = intent.tokens
      .map((token) => `${token.replace(/[^a-z0-9]/g, '')}:*`)
      .join(' | ');
    parameters.push(query);
    condition += ` AND search_document @@ to_tsquery('simple', $${parameters.length})`;
  }
  const result = await pool.query(
    `SELECT * FROM products WHERE organization_id = $1 ${condition}
    ORDER BY display_order LIMIT 2000`,
    parameters,
  );
  return result.rows.map(mapProduct);
}

async function feedback({ pool, organizationId }, { productId, helpful }) {
  const result = await pool.query(
    `INSERT INTO recommendation_feedback (id, organization_id, product_id, helpful)
    SELECT $1, $2, $3, $4 WHERE EXISTS (SELECT 1 FROM products WHERE organization_id = $2 AND id = $3)
    RETURNING id`,
    [randomUUID(), organizationId, productId, helpful],
  );
  return result.rows.length === 1;
}

async function reserve({ pool, organizationId }, day, limit) {
  const result = await pool.query(
    `INSERT INTO ai_daily_usage (organization_id, day, request_count) VALUES ($1,$2,1)
    ON CONFLICT (organization_id, day) DO UPDATE SET request_count = ai_daily_usage.request_count + 1
    WHERE ai_daily_usage.request_count < $3 RETURNING request_count`,
    [organizationId, day, limit],
  );
  return result.rows.length === 1;
}
