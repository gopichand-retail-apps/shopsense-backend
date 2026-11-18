import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresRepository } from './postgres.repository.mjs';
import { seedPostgresCatalog } from './postgres-seed.mjs';
import { buildSampleCatalog } from './sample-catalog.mjs';
import { createRecommendationService } from '../recommendation.service.mjs';
import { loadModel } from '../server.mjs';

const schema = readFileSync(
  new URL('../../supabase/schemas/shopsense.sql', import.meta.url),
  'utf8',
);
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';

async function fixture(t) {
  const database = new PGlite();
  await database.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  await database.exec(schema);
  await database.exec(
    readFileSync(
      new URL('../../supabase/schemas/shopsense_runtime.sql', import.meta.url),
      'utf8',
    ),
  );
  const pool = {
    query: (...args) => database.query(...args),
    end: async () => {},
    connect: async () => ({
      query: (...args) => database.query(...args),
      release() {},
    }),
  };
  t.after(() => database.close());
  const model = loadModel();
  const organizationId = await seedPostgresCatalog({
    pool,
    model,
    catalogProducts: buildSampleCatalog(),
  });
  const repository = createPostgresRepository({ pool, organizationId });
  await database.query(
    'INSERT INTO shopsense_private.runtime_bindings VALUES ($1,$2)',
    ['shopsense_runtime', organizationId],
  );
  return { database, pool, model, organizationId, repository };
}

async function verifyPaging(repository) {
  assert.equal((await repository.catalogPage({})).length, 24);
  assert.equal(
    (await repository.catalogPage({ category: 'home', limit: 100 })).length,
    31,
  );
  assert.equal(
    (
      await repository.catalogPage({
        category: 'bags',
        ids: ['sample-backpack-30'],
      })
    ).length,
    1,
  );
  assert.equal(
    (await repository.getProduct('sample-backpack-30')).color,
    'white',
  );
  assert.equal(await repository.getProduct('missing'), null);
}

async function seedMemberships(database, organizationId) {
  const id = randomUUID();
  await database.query('INSERT INTO auth.users (id) VALUES ($1),($2)', [
    alice,
    bob,
  ]);
  await database.query('INSERT INTO organizations (id,name) VALUES ($1,$2)', [
    id,
    'Other synthetic store',
  ]);
  await database.query(
    `INSERT INTO organization_members (organization_id,user_id,role)
    VALUES ($1,$2,'employee'),($3,$4,'editor')`,
    [organizationId, alice, id, bob],
  );
  return id;
}

async function rejectAnonymousAccess(database) {
  await database.exec('SET ROLE anon');
  await assert.rejects(
    database.query('SELECT * FROM products'),
    /permission denied/,
  );
}

test('Postgres adapter stores and searches 308 products, pages and isolates organization keys', async (t) => {
  const { repository, database, pool, model, organizationId } =
    await fixture(t);
  assert.equal(await repository.countProducts(), 308);
  await verifyPaging(repository);
  const service = createRecommendationService({ repository, model });
  const result = await service.recommend('black dress for men');
  assert.equal(result.resultCount, 2);
  assert.ok(result.results.every((item) => item.product.audience === 'men'));
  assert.ok((await service.recommend('headphones not black')).resultCount > 0);
  assert.ok((await service.recommend('quiet focus')).resultCount > 0);
  assert.equal(
    await repository.recordFeedback({ productId: 'missing', helpful: true }),
    false,
  );
  assert.equal(
    await repository.recordFeedback({
      productId: 'sample-dress-01',
      helpful: false,
    }),
    true,
  );
  assert.equal(await repository.reserveAiRequest('2026-11-13', 1), true);
  assert.equal(await repository.reserveAiRequest('2026-11-13', 1), false);
  await seedPostgresCatalog({
    pool,
    model,
    organizationId,
    catalogProducts: buildSampleCatalog(),
  });
  assert.equal(await repository.countProducts(), 308);
  const other = createPostgresRepository({
    pool,
    organizationId: randomUUID(),
  });
  assert.equal(await other.countProducts(), 0);
  assert.equal(await other.getProduct('sample-dress-01'), null);
  assert.throws(() =>
    createPostgresRepository({ pool, organizationId: 'invalid' }),
  );
  assert.ok(
    (await database.query('SELECT * FROM query_sessions')).rows.length > 0,
  );
  await repository.close();
});

test('the runtime login can search and record usage but cannot escape its bound store', async (t) => {
  const { database, repository } = await fixture(t);
  const other = randomUUID();
  await database.query(
    "INSERT INTO organizations (id,name) VALUES ($1,'Other')",
    [other],
  );
  await database.query("INSERT INTO categories VALUES ($1,'apparel',0)", [
    other,
  ]);
  await database.exec('SET ROLE shopsense_runtime');
  assert.equal(await repository.countProducts(), 308);
  assert.equal((await repository.catalogPage()).length, 24);
  await repository.recordQuery({
    queryHash: 'synthetic',
    intentCategory: null,
    resultCount: 1,
  });
  assert.equal(
    await repository.recordFeedback({
      productId: 'sample-dress-01',
      helpful: true,
    }),
    true,
  );
  assert.equal(await repository.reserveAiRequest('2026-11-13', 1), true);
  assert.equal(await repository.reserveAiRequest('2026-11-13', 1), false);
  assert.equal(
    (
      await database.query(
        'SELECT * FROM categories WHERE organization_id=$1',
        [other],
      )
    ).rows.length,
    0,
  );
  await assertRuntimeDenials(database, other);
  await database.exec('RESET ROLE');
});

async function assertRuntimeDenials(database, other) {
  for (const query of [
    'SELECT * FROM organizations',
    'SELECT * FROM organization_members',
    'SELECT * FROM query_sessions',
    'SELECT * FROM recommendation_feedback',
    "UPDATE products SET brand='Unauthorized'",
    'DELETE FROM products',
    'UPDATE shopsense_private.runtime_bindings SET organization_id = organization_id',
  ])
    await assert.rejects(database.query(query), /permission denied/);
  await assert.rejects(
    database.query('INSERT INTO ai_daily_usage VALUES ($1,$2,1)', [
      other,
      '2026-11-13',
    ]),
    /row-level security/,
  );
  await assert.rejects(
    database.query(
      "INSERT INTO query_sessions (organization_id,query_hash,result_count) VALUES ($1,'synthetic',0)",
      [other],
    ),
    /row-level security/,
  );
}

test('RLS denies anonymous access, cross-company reads and employee writes', async (t) => {
  const { database, organizationId } = await fixture(t);
  const otherOrganization = await seedMemberships(database, organizationId);
  await rejectAnonymousAccess(database);
  await database.exec(
    `RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = '${alice}'`,
  );
  assert.equal(
    (await database.query('SELECT COUNT(*)::integer AS count FROM products'))
      .rows[0].count,
    308,
  );
  assert.equal(
    (
      await database.query('SELECT * FROM organizations WHERE id=$1', [
        otherOrganization,
      ])
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await database.query(
        "UPDATE products SET name='Unauthorized change' RETURNING id",
      )
    ).rows.length,
    0,
  );
  await database.exec(
    `RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = '${bob}'`,
  );
  assert.equal((await database.query('SELECT * FROM products')).rows.length, 0);
  assert.equal(
    (
      await database.query(
        "UPDATE products SET name='Cross-company change' RETURNING id",
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    database.query('INSERT INTO organization_members VALUES ($1,$2,$3)', [
      organizationId,
      bob,
      'owner',
    ]),
    /permission denied/,
  );
  await database.exec('RESET ROLE');
});

test('Postgres seeding rolls back all inserts after a foreign-key failure', async (t) => {
  const { database, pool, model } = await fixture(t);
  const id = randomUUID();
  const product = {
    ...model.seed.products[0],
    id: 'invalid-category',
    category: 'not-present',
  };
  await assert.rejects(
    seedPostgresCatalog({
      pool,
      model,
      organizationId: id,
      catalogProducts: [product],
    }),
    /foreign key/,
  );
  assert.equal(
    (await database.query('SELECT * FROM organizations WHERE id=$1', [id])).rows
      .length,
    0,
  );
});

test('an editor can update its own catalog but cannot move a product into another company', async (t) => {
  const { database, organizationId } = await fixture(t);
  const other = randomUUID();
  await database.query('INSERT INTO auth.users (id) VALUES ($1)', [bob]);
  await database.query(
    "INSERT INTO organization_members VALUES ($1,$2,'editor')",
    [organizationId, bob],
  );
  await database.query(
    "INSERT INTO organizations (id,name) VALUES ($1,'Other store')",
    [other],
  );
  await database.query("INSERT INTO categories VALUES ($1,'apparel',0)", [
    other,
  ]);
  await database.exec(
    `SET ROLE authenticated; SET request.jwt.claim.sub = '${bob}'`,
  );
  const changed = await database.query(
    "UPDATE products SET brand='Edited synthetic brand' WHERE id=$1 RETURNING id",
    ['sample-dress-01'],
  );
  assert.equal(changed.rows.length, 1);
  await assert.rejects(
    database.query('UPDATE products SET organization_id=$1 WHERE id=$2', [
      other,
      'sample-dress-01',
    ]),
    /row-level security/,
  );
  await assert.rejects(
    database.query("UPDATE organization_members SET role='owner'"),
    /permission denied/,
  );
  await assert.rejects(
    database.query('SELECT * FROM ai_daily_usage'),
    /permission denied/,
  );
  await database.exec('RESET ROLE');
  assert.equal(
    (
      await database.query('SELECT organization_id FROM products WHERE id=$1', [
        'sample-dress-01',
      ])
    ).rows[0].organization_id,
    organizationId,
  );
});
