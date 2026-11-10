import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCatalogRepository } from './catalog.repository.mjs';
import { loadModel } from './server.mjs';

function createRepository(t) {
  const model = loadModel();
  const repository = createCatalogRepository({
    databasePath: ':memory:',
    model,
  });
  t.after(() => repository.close());
  return { model, repository };
}

test('lists all catalog products or only the requested category', (t) => {
  const { model, repository } = createRepository(t);
  const allProducts = repository.listProducts();
  const bags = repository.listProducts('bags');

  assert.equal(allProducts.length, model.seed.products.length);
  assert.ok(bags.length > 0);
  assert.ok(bags.every((product) => product.category === 'bags'));
  assert.equal(
    repository.getProduct(allProducts[0].id)?.name,
    allProducts[0].name,
  );
  assert.equal(repository.getProduct('missing-product'), null);
});

test('records query metadata and accepts feedback only for known products', (t) => {
  const { model, repository } = createRepository(t);
  repository.recordQuery({
    queryHash: 'keyed-hash',
    intentCategory: 'bags',
    resultCount: 2,
  });

  assert.equal(
    repository.recordFeedback({
      productId: model.seed.products[0].id,
      helpful: true,
    }),
    true,
  );
  assert.equal(
    repository.recordFeedback({ productId: 'missing-product', helpful: false }),
    false,
  );
});

test('rolls back failed seed transactions and closes the database handle', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'shopsense-repository-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'catalog.sqlite');
  const model = loadModel();
  model.seed.products[0].category = 'missing-category';

  assert.throws(
    () => createCatalogRepository({ databasePath, model }),
    /FOREIGN KEY constraint failed/,
  );

  const database = new DatabaseSync(databasePath);
  const categoryCount = database
    .prepare('SELECT COUNT(*) AS count FROM categories')
    .get();
  assert.equal(Number(categoryCount.count), 0);
  database.close();
});
