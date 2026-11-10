import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseShopSenseModel } from './model.schema.mjs';

const envelope = JSON.parse(
  await readFile(
    new URL(
      '../../../shopsense-frontend/public/shopsense-ai-model.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

test('parses the strict versioned ShopSense envelope into the API model', () => {
  const model = parseShopSenseModel(envelope);

  assert.equal(model.modelVersion, envelope.version);
  assert.equal(model.app.locale, envelope.locale);
  assert.equal(model.seed.products.length, envelope.data.seed.products.length);
  assert.equal(
    model.copy.errors.invalidSearch,
    envelope.messages.errors.invalidSearch,
  );
});

test('rejects a wrong app ID, missing data, and public architecture fields', () => {
  assert.throws(() => parseShopSenseModel({ ...envelope, appId: 'other-app' }));

  const { data: _data, ...missingData } = envelope;
  assert.throws(() => parseShopSenseModel(missingData));
  assert.throws(() =>
    parseShopSenseModel({
      ...envelope,
      architecture: { diagram: 'not product data' },
    }),
  );
});

test('rejects invalid nested product and API configuration data', () => {
  const invalidProduct = structuredClone(envelope);
  invalidProduct.data.seed.products[0].priceCents = -1;
  assert.throws(() => parseShopSenseModel(invalidProduct));

  const invalidApp = structuredClone(envelope);
  invalidApp.data.app.allowedOrigin = 'not-an-origin';
  assert.throws(() => parseShopSenseModel(invalidApp));
});
