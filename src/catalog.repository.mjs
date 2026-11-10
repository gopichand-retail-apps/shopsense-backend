import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

function transaction(database, work) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function mapProduct(row) {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    priceCents: Number(row.price_cents),
    description: row.description,
    imageUrl: row.image_url,
    imageAlt: row.image_alt,
    attributes: JSON.parse(row.attributes_json),
    matchTags: JSON.parse(row.match_tags_json),
  };
}

function getProduct(database, id) {
  const row = database.prepare('SELECT * FROM products WHERE id = ?').get(id);
  return row ? mapProduct(row) : null;
}

export function createCatalogRepository({ databasePath, model }) {
  const database = new DatabaseSync(databasePath);
  try {
    initializeSchema(database);
    seedCatalog(database, model);
  } catch (error) {
    database.close();
    throw error;
  }
  return createRepository(database);
}

function initializeSchema(database) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      display_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      brand TEXT NOT NULL,
      category TEXT NOT NULL REFERENCES categories(id),
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      description TEXT NOT NULL,
      image_url TEXT NOT NULL,
      image_alt TEXT NOT NULL,
      attributes_json TEXT NOT NULL,
      match_tags_json TEXT NOT NULL,
      display_order INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS products_category_order_idx ON products(category, display_order);
    CREATE TABLE IF NOT EXISTS query_sessions (
      id TEXT PRIMARY KEY,
      query_hash TEXT NOT NULL,
      intent_category TEXT,
      result_count INTEGER NOT NULL CHECK (result_count >= 0),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS query_sessions_created_idx ON query_sessions(created_at);
    CREATE TABLE IF NOT EXISTS recommendation_feedback (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      helpful INTEGER NOT NULL CHECK (helpful IN (0, 1)),
      created_at TEXT NOT NULL
    );
  `);
}

function seedCatalog(database, model) {
  const insertCategory = database.prepare(
    'INSERT OR IGNORE INTO categories (id, display_order) VALUES (?, ?)',
  );
  const insertProduct = database.prepare(`
    INSERT OR IGNORE INTO products (
      id, name, brand, category, price_cents, description, image_url, image_alt,
      attributes_json, match_tags_json, display_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  transaction(database, () => {
    for (const [index, category] of model.categories.entries()) {
      insertCategory.run(category.id, index + 1);
    }
    model.seed.products.forEach((product, index) => {
      insertProduct.run(
        product.id,
        product.name,
        product.brand,
        product.category,
        product.priceCents,
        product.description,
        product.imageUrl,
        product.imageAlt,
        JSON.stringify(product.attributes),
        JSON.stringify(product.matchTags),
        index + 1,
      );
    });
  });
}

function createRepository(database) {
  return {
    listProducts: (category = null) => listProducts(database, category),
    getProduct(id) {
      return getProduct(database, id);
    },
    recordQuery: (record) => writeQueryRecord(database, record),
    recordFeedback: (record) => writeFeedback(database, record),
    close: () => database.close(),
  };
}

function listProducts(database, category) {
  const rows = category
    ? database
        .prepare(
          'SELECT * FROM products WHERE category = ? ORDER BY display_order',
        )
        .all(category)
    : database.prepare('SELECT * FROM products ORDER BY display_order').all();
  return rows.map(mapProduct);
}

function writeQueryRecord(
  database,
  { queryHash, intentCategory, resultCount },
) {
  database
    .prepare(
      `
    INSERT INTO query_sessions (id, query_hash, intent_category, result_count, created_at)
    VALUES (?, ?, ?, ?, ?)
  `,
    )
    .run(
      randomUUID(),
      queryHash,
      intentCategory,
      resultCount,
      new Date().toISOString(),
    );
}

function writeFeedback(database, { productId, helpful }) {
  if (!getProduct(database, productId)) return false;
  database
    .prepare(
      `
    INSERT INTO recommendation_feedback (id, product_id, helpful, created_at)
    VALUES (?, ?, ?, ?)
  `,
    )
    .run(randomUUID(), productId, Number(helpful), new Date().toISOString());
  return true;
}
