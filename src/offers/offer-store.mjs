import { z } from 'zod';
import { buildProductClauses } from '../catalog/sqlite-search.mjs';
import { transaction } from '../catalog/transaction.mjs';

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const identifier = z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/);
const instant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/);
const sourceVersion = z.number().int().positive();
const key = { merchantId: identifier, sku: identifier };
const schemas = {
  location: z
    .object({ id: identifier, name: z.string().min(1).max(120) })
    .strict(),
  offer: z
    .object({
      ...key,
      productId: z.string().min(1).max(80),
      sourceVersion,
      priceCents: z.number().int().nonnegative(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      updatedAt: instant,
    })
    .strict(),
  withdrawal: z
    .object({ ...key, sourceVersion, withdrawnAt: instant })
    .strict(),
  availability: z
    .object({
      ...key,
      locationId: identifier,
      state: z.enum(['in_stock', 'out_of_stock', 'unknown']),
      confirmedAt: instant,
      sourceVersion,
    })
    .strict(),
};

const OFFER_COLUMNS = `p.*, o.merchant_id, o.sku, o.source_version, o.offer_price_cents,
  o.currency, o.updated_at, a.state AS availability_state,
  a.confirmed_at AS availability_confirmed_at`;
const OFFER_JOIN = `FROM products p
  JOIN offers o ON o.product_id = p.id AND o.withdrawn_at IS NULL
  LEFT JOIN offer_availability a ON a.merchant_id = o.merchant_id
    AND a.sku = o.sku AND a.location_id = ?`;

function initializeOfferSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS offers (
      merchant_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      product_id TEXT NOT NULL UNIQUE REFERENCES products(id),
      source_version INTEGER NOT NULL CHECK (source_version > 0),
      offer_price_cents INTEGER NOT NULL CHECK (offer_price_cents >= 0),
      currency TEXT NOT NULL CHECK (length(currency) = 3),
      updated_at TEXT NOT NULL,
      withdrawn_at TEXT,
      PRIMARY KEY (merchant_id, sku)
    );
    CREATE TABLE IF NOT EXISTS offer_availability (
      merchant_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      location_id TEXT NOT NULL REFERENCES locations(id),
      state TEXT NOT NULL CHECK (state IN ('in_stock', 'out_of_stock', 'unknown')),
      confirmed_at TEXT NOT NULL,
      source_version INTEGER NOT NULL CHECK (source_version > 0),
      PRIMARY KEY (merchant_id, sku, location_id),
      FOREIGN KEY (merchant_id, sku) REFERENCES offers(merchant_id, sku)
    );
  `);
}

function parseInstants(input, schema, fields, now) {
  const value = schema.parse(input);
  const limit = now().getTime() + FUTURE_TOLERANCE_MS;
  for (const field of fields) {
    const time = Date.parse(value[field]);
    if (Number.isNaN(time))
      throw new RangeError(`${field} is not a valid instant.`);
    if (time > limit) throw new RangeError(`${field} is in the future.`);
    value[field] = new Date(time).toISOString();
  }
  return value;
}

function mapOfferRow(row, mapProduct) {
  const priceCents = Number(row.offer_price_cents);
  return {
    ...mapProduct(row),
    priceCents,
    offer: {
      merchantId: row.merchant_id,
      sku: row.sku,
      sourceVersion: Number(row.source_version),
      priceCents,
      currency: row.currency,
      updatedAt: row.updated_at,
    },
    availability: row.availability_state
      ? {
          state: row.availability_state,
          confirmedAt: row.availability_confirmed_at,
        }
      : null,
  };
}

function decidePublish(current, offer) {
  if (offer.sourceVersion < current.source_version) return 'stale';
  if (offer.sourceVersion > current.source_version) return 'updated';
  if (current.withdrawn_at) return 'stale';
  const same =
    current.product_id === offer.productId &&
    Number(current.offer_price_cents) === offer.priceCents &&
    current.currency === offer.currency &&
    current.updated_at === offer.updatedAt;
  return same ? 'unchanged' : 'conflict';
}

function decideAvailability(current, next) {
  if (next.sourceVersion !== current.source_version)
    return next.sourceVersion > current.source_version ? 'recorded' : 'stale';
  if (next.confirmedAt > current.confirmed_at) return 'recorded';
  if (next.confirmedAt < current.confirmed_at) return 'stale';
  return next.state === current.state ? 'unchanged' : 'conflict';
}

function priceClauses(filters) {
  const clauses = [];
  const parameters = [];
  for (const [bound, comparison] of [
    ['minimumPriceCents', '>='],
    ['maximumPriceCents', '<='],
  ]) {
    if (filters[bound] === null || filters[bound] === undefined) continue;
    clauses.push(`o.offer_price_cents ${comparison} ?`);
    parameters.push(filters[bound]);
  }
  return { clauses, parameters };
}

const find = (database, sql, ...values) => database.prepare(sql).get(...values);
const offerKey = (value) => [value.merchantId, value.sku];

function upsertLocations(database, locations) {
  const parsed = locations.map((location) => schemas.location.parse(location));
  const statement =
    database.prepare(`INSERT INTO locations (id, name, display_order)
    VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name,
    display_order = excluded.display_order`);
  transaction(database, () =>
    parsed.forEach((location, index) =>
      statement.run(location.id, location.name, index + 1),
    ),
  );
}

function publishOffer(database, now, input) {
  const offer = parseInstants(input, schemas.offer, ['updatedAt'], now);
  return transaction(database, () => {
    if (!find(database, 'SELECT 1 FROM products WHERE id = ?', offer.productId))
      return { outcome: 'unknown_product' };
    const taken = find(
      database,
      'SELECT 1 FROM offers WHERE product_id = ? AND NOT (merchant_id = ? AND sku = ?)',
      offer.productId,
      ...offerKey(offer),
    );
    if (taken) return { outcome: 'conflict' };
    const current = find(
      database,
      'SELECT * FROM offers WHERE merchant_id = ? AND sku = ?',
      ...offerKey(offer),
    );
    const outcome = current ? decidePublish(current, offer) : 'created';
    if (outcome === 'created' || outcome === 'updated')
      writeOffer(database, offer);
    return { outcome };
  });
}

function withdrawOffer(database, now, input) {
  const withdrawal = parseInstants(
    input,
    schemas.withdrawal,
    ['withdrawnAt'],
    now,
  );
  return transaction(database, () => {
    const current = find(
      database,
      'SELECT * FROM offers WHERE merchant_id = ? AND sku = ?',
      ...offerKey(withdrawal),
    );
    if (!current) return { outcome: 'unknown_offer' };
    if (withdrawal.sourceVersion < current.source_version)
      return { outcome: 'stale' };
    if (
      current.withdrawn_at &&
      withdrawal.sourceVersion === current.source_version
    )
      return { outcome: 'unchanged' };
    database
      .prepare(
        'UPDATE offers SET source_version = ?, withdrawn_at = ? WHERE merchant_id = ? AND sku = ?',
      )
      .run(
        withdrawal.sourceVersion,
        withdrawal.withdrawnAt,
        ...offerKey(withdrawal),
      );
    return { outcome: 'withdrawn' };
  });
}

function recordAvailability(database, now, input) {
  const next = parseInstants(input, schemas.availability, ['confirmedAt'], now);
  return transaction(database, () => {
    const active = find(
      database,
      'SELECT 1 FROM offers WHERE merchant_id = ? AND sku = ? AND withdrawn_at IS NULL',
      ...offerKey(next),
    );
    if (!active) return { outcome: 'unknown_offer' };
    if (
      !find(database, 'SELECT 1 FROM locations WHERE id = ?', next.locationId)
    )
      return { outcome: 'unknown_location' };
    const current = find(
      database,
      'SELECT * FROM offer_availability WHERE merchant_id = ? AND sku = ? AND location_id = ?',
      ...offerKey(next),
      next.locationId,
    );
    const outcome = current ? decideAvailability(current, next) : 'recorded';
    if (outcome === 'recorded') writeAvailability(database, next);
    return { outcome };
  });
}

function writeOffer(database, offer) {
  database
    .prepare(
      `INSERT INTO offers (merchant_id, sku, product_id, source_version, offer_price_cents,
         currency, updated_at, withdrawn_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(merchant_id, sku) DO UPDATE SET product_id = excluded.product_id,
         source_version = excluded.source_version, offer_price_cents = excluded.offer_price_cents,
         currency = excluded.currency, updated_at = excluded.updated_at, withdrawn_at = NULL`,
    )
    .run(
      offer.merchantId,
      offer.sku,
      offer.productId,
      offer.sourceVersion,
      offer.priceCents,
      offer.currency,
      offer.updatedAt,
    );
}

function writeAvailability(database, next) {
  database
    .prepare(
      `INSERT INTO offer_availability (merchant_id, sku, location_id, state, confirmed_at, source_version)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(merchant_id, sku, location_id) DO UPDATE SET state = excluded.state,
         confirmed_at = excluded.confirmed_at, source_version = excluded.source_version`,
    )
    .run(
      next.merchantId,
      next.sku,
      next.locationId,
      next.state,
      next.confirmedAt,
      next.sourceVersion,
    );
}

function selectOffers(database, mapProduct, sql, values) {
  return database
    .prepare(sql)
    .all(...values)
    .map((row) => mapOfferRow(row, mapProduct));
}

function retrieveOffers(database, mapProduct, query) {
  const {
    categoryId = null,
    filters = {},
    tokens = [],
    locationId = null,
  } = query;
  const facets = buildProductClauses({
    categoryId,
    tokens,
    filters: { ...filters, minimumPriceCents: null, maximumPriceCents: null },
  });
  const price = priceClauses(filters);
  const clauses = [...facets.clauses, ...price.clauses];
  const parameters = [
    locationId ?? '',
    ...facets.parameters,
    ...price.parameters,
  ];
  if (query.availableOnly) {
    clauses.push("a.state = 'in_stock'");
    if (query.freshAfter) {
      clauses.push('a.confirmed_at >= ?');
      parameters.push(query.freshAfter);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return selectOffers(
    database,
    mapProduct,
    `SELECT ${OFFER_COLUMNS} ${OFFER_JOIN} ${where} ORDER BY p.display_order LIMIT 2000`,
    parameters,
  );
}

function pageOffers(database, mapProduct, query) {
  const { category = null, ids = [], offset = 0, limit = 24 } = query;
  const location = query.locationId ?? '';
  let clause = '1 = 1';
  let values = [];
  if (ids.length) {
    clause = `p.id IN (${ids.map(() => '?').join(',')})`;
    values = ids;
  } else if (category) {
    clause = 'p.category = ?';
    values = [category];
  }
  const total = Number(
    database
      .prepare(`SELECT COUNT(*) AS total ${OFFER_JOIN} WHERE ${clause}`)
      .get(location, ...values).total,
  );
  const items = selectOffers(
    database,
    mapProduct,
    `SELECT ${OFFER_COLUMNS} ${OFFER_JOIN} WHERE ${clause} ORDER BY p.display_order LIMIT ? OFFSET ?`,
    [location, ...values, limit, offset],
  );
  return { items, total };
}

function readFeedStatus(database) {
  const counts = find(
    database,
    `SELECT SUM(withdrawn_at IS NULL) AS active, SUM(withdrawn_at IS NOT NULL) AS withdrawn,
       MAX(CASE WHEN withdrawn_at IS NULL THEN updated_at END) AS offer_watermark FROM offers`,
  );
  const confirmed = find(
    database,
    `SELECT MAX(a.confirmed_at) AS watermark FROM offer_availability a
     JOIN offers o ON o.merchant_id = a.merchant_id AND o.sku = a.sku AND o.withdrawn_at IS NULL`,
  );
  const marks = [counts.offer_watermark, confirmed.watermark]
    .filter(Boolean)
    .sort();
  return {
    offerCount: Number(counts.active ?? 0),
    withdrawnCount: Number(counts.withdrawn ?? 0),
    locationCount: Number(
      find(database, 'SELECT COUNT(*) AS total FROM locations').total,
    ),
    watermark: marks.at(-1) ?? null,
  };
}

export function createOfferStore(
  database,
  mapProduct,
  { now = () => new Date() } = {},
) {
  initializeOfferSchema(database);
  return {
    batch: (work) => transaction(database, work),
    upsertLocations: (locations) => upsertLocations(database, locations),
    publishOffer: (input) => publishOffer(database, now, input),
    withdrawOffer: (input) => withdrawOffer(database, now, input),
    recordAvailability: (input) => recordAvailability(database, now, input),
    listLocations: () =>
      database
        .prepare('SELECT id, name FROM locations ORDER BY display_order')
        .all(),
    hasLocation: (id) =>
      Boolean(find(database, 'SELECT 1 FROM locations WHERE id = ?', id)),
    retrieve: (query) => retrieveOffers(database, mapProduct, query),
    page: (query) => pageOffers(database, mapProduct, query),
    feedStatus: () => readFeedStatus(database),
  };
}
