import { randomUUID } from 'node:crypto';
import { productSchema } from '../types/model.schema.mjs';

export async function seedPostgresCatalog({
  pool,
  model,
  catalogProducts,
  organizationId = randomUUID(),
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO organizations (id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [organizationId, 'ShopSense synthetic store'],
    );
    const categories = model.categories.map((category, displayOrder) => ({
      id: category.id,
      displayOrder,
    }));
    await client.query(
      `INSERT INTO categories (organization_id,id,display_order)
      SELECT $1,id,"displayOrder" FROM jsonb_to_recordset($2::jsonb) AS c(id text,"displayOrder" integer)
      ON CONFLICT DO NOTHING`,
      [organizationId, JSON.stringify(categories)],
    );
    await insertProducts(client, organizationId, [
      ...model.seed.products,
      ...catalogProducts,
    ]);
    await client.query('COMMIT');
    return organizationId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function insertProducts(client, organizationId, records) {
  const products = records.map((record, displayOrder) => ({
    ...productSchema.parse(record),
    displayOrder,
  }));
  await client.query(
    `INSERT INTO products (organization_id,id,name,brand,category,price_cents,description,
    image_url,image_alt,attributes_json,match_tags_json,display_order,color,audience,product_type)
    SELECT $1,id,name,brand,category,"priceCents",description,"imageUrl","imageAlt",attributes,"matchTags",
      "displayOrder",color,audience,"productType"
    FROM jsonb_to_recordset($2::jsonb) AS p(id text,name text,brand text,category text,"priceCents" integer,
      description text,"imageUrl" text,"imageAlt" text,attributes jsonb,"matchTags" jsonb,"displayOrder" integer,
      color text,audience text,"productType" text) ON CONFLICT DO NOTHING`,
    [organizationId, JSON.stringify(products)],
  );
}
