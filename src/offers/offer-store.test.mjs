import assert from 'node:assert/strict';
import test from 'node:test';
import { createCatalogRepository } from '../catalog.repository.mjs';
import { loadModel } from '../server.mjs';

const NOW = new Date('2026-11-24T12:00:00.000Z');
const headphones = {
  id: 'hp-1',
  name: 'Studio Headphones X',
  brand: 'Acme',
  category: 'audio',
  priceCents: 12900,
  description: 'Closed back headphones',
  imageUrl: '/catalog/headphones-black.svg',
  imageAlt: 'Headphones',
  attributes: ['Closed back', 'Noise cancelling'],
  matchTags: ['headphones'],
  color: 'black',
  audience: 'unisex',
  productType: 'headphones',
};

function setup(t) {
  const repository = createCatalogRepository({
    databasePath: ':memory:',
    model: loadModel(),
    catalogProducts: [headphones],
    now: () => NOW,
  });
  t.after(() => repository.close());
  repository.offers.upsertLocations([
    { id: 'store-a', name: 'Store A' },
    { id: 'store-b', name: 'Store B' },
  ]);
  return repository.offers;
}

const offer = (overrides = {}) => ({
  merchantId: 'm-1',
  sku: 'SKU-1',
  productId: 'hp-1',
  sourceVersion: 1,
  priceCents: 12900,
  currency: 'USD',
  updatedAt: '2026-11-24T11:00:00.000Z',
  ...overrides,
});
const stock = (overrides = {}) => ({
  merchantId: 'm-1',
  sku: 'SKU-1',
  locationId: 'store-a',
  state: 'in_stock',
  confirmedAt: '2026-11-24T11:30:00.000Z',
  sourceVersion: 1,
  ...overrides,
});
const visible = (offers) => offers.page({ limit: 50, offset: 0 }).items;

test('processing the same offer twice keeps one projection row', (t) => {
  const offers = setup(t);

  assert.equal(offers.publishOffer(offer()).outcome, 'created');
  assert.equal(offers.publishOffer(offer()).outcome, 'unchanged');
  assert.equal(offers.feedStatus().offerCount, 1);
  const [item] = visible(offers);
  assert.deepEqual(item.offer, {
    merchantId: 'm-1',
    sku: 'SKU-1',
    sourceVersion: 1,
    priceCents: 12900,
    currency: 'USD',
    updatedAt: '2026-11-24T11:00:00.000Z',
  });
});

test('an older source version is ignored and a newer one updates the price', (t) => {
  const offers = setup(t);
  offers.publishOffer(offer({ sourceVersion: 2, priceCents: 15900 }));

  assert.equal(
    offers.publishOffer(offer({ sourceVersion: 1 })).outcome,
    'stale',
  );
  assert.equal(visible(offers)[0].priceCents, 15900);
  assert.equal(
    offers.publishOffer(offer({ sourceVersion: 3, priceCents: 9900 })).outcome,
    'updated',
  );
  assert.equal(visible(offers)[0].priceCents, 9900);
  assert.equal(visible(offers)[0].offer.sourceVersion, 3);
});

test('the same version with a different payload is a conflict, not an overwrite', (t) => {
  const offers = setup(t);
  offers.publishOffer(offer());

  assert.equal(
    offers.publishOffer(offer({ priceCents: 1 })).outcome,
    'conflict',
  );
  assert.equal(visible(offers)[0].priceCents, 12900);
});

test('an offer for an unknown product is rejected without a row', (t) => {
  const offers = setup(t);

  assert.equal(
    offers.publishOffer(offer({ productId: 'missing' })).outcome,
    'unknown_product',
  );
  assert.equal(offers.feedStatus().offerCount, 0);
});

test('a withdrawal removes the offer from retrieval, paging and id lookup', (t) => {
  const offers = setup(t);
  offers.publishOffer(offer());

  assert.equal(
    offers.withdrawOffer({
      merchantId: 'm-1',
      sku: 'SKU-1',
      sourceVersion: 2,
      withdrawnAt: '2026-11-24T11:45:00.000Z',
    }).outcome,
    'withdrawn',
  );
  assert.deepEqual(visible(offers), []);
  assert.deepEqual(
    offers.page({ ids: ['hp-1'], limit: 50, offset: 0 }).items,
    [],
  );
  assert.deepEqual(offers.retrieve({ filters: {}, tokens: [] }), []);
  assert.deepEqual(
    {
      offers: offers.feedStatus().offerCount,
      withdrawn: offers.feedStatus().withdrawnCount,
    },
    { offers: 0, withdrawn: 1 },
  );
});

test('withdrawals respect source versions and a newer publication restores the offer', (t) => {
  const offers = setup(t);
  offers.publishOffer(offer({ sourceVersion: 3 }));
  const withdraw = (sourceVersion) =>
    offers.withdrawOffer({
      merchantId: 'm-1',
      sku: 'SKU-1',
      sourceVersion,
      withdrawnAt: '2026-11-24T11:45:00.000Z',
    });

  assert.equal(withdraw(2).outcome, 'stale');
  assert.equal(visible(offers).length, 1);
  assert.equal(withdraw(4).outcome, 'withdrawn');
  assert.equal(withdraw(4).outcome, 'unchanged');
  assert.equal(
    offers.publishOffer(offer({ sourceVersion: 4 })).outcome,
    'stale',
  );
  assert.equal(
    offers.publishOffer(offer({ sourceVersion: 5 })).outcome,
    'updated',
  );
  assert.equal(visible(offers).length, 1);
  assert.equal(
    offers.withdrawOffer({
      merchantId: 'm-1',
      sku: 'NOPE',
      sourceVersion: 1,
      withdrawnAt: '2026-11-24T11:45:00.000Z',
    }).outcome,
    'unknown_offer',
  );
});

test('availability keeps the newest confirmation and ignores older source versions', (t) => {
  const offers = setup(t);
  offers.publishOffer(offer());

  assert.equal(offers.recordAvailability(stock()).outcome, 'recorded');
  assert.equal(offers.recordAvailability(stock()).outcome, 'unchanged');
  assert.equal(
    offers.recordAvailability(
      stock({ confirmedAt: '2026-11-24T11:40:00.000Z' }),
    ).outcome,
    'recorded',
  );
  assert.equal(
    offers.recordAvailability(
      stock({ confirmedAt: '2026-11-24T11:10:00.000Z' }),
    ).outcome,
    'stale',
  );
  assert.equal(
    offers.recordAvailability(
      stock({ confirmedAt: '2026-11-24T11:40:00.000Z', state: 'out_of_stock' }),
    ).outcome,
    'conflict',
  );
  offers.recordAvailability(stock({ sourceVersion: 2, state: 'out_of_stock' }));
  assert.equal(
    offers.recordAvailability(stock({ sourceVersion: 1 })).outcome,
    'stale',
  );
  assert.equal(
    offers.recordAvailability(stock({ locationId: 'nowhere' })).outcome,
    'unknown_location',
  );
  assert.equal(
    offers.recordAvailability(stock({ sku: 'NOPE' })).outcome,
    'unknown_offer',
  );
});

test('retrieval joins the offer price and the requested location availability', (t) => {
  const offers = setup(t);
  offers.publishOffer(offer({ priceCents: 12900 }));
  offers.recordAvailability(stock());
  offers.recordAvailability(
    stock({ locationId: 'store-b', state: 'out_of_stock' }),
  );

  const atA = offers.retrieve({
    filters: {},
    tokens: [],
    locationId: 'store-a',
  });
  const atB = offers.retrieve({
    filters: {},
    tokens: [],
    locationId: 'store-b',
  });
  const noLocation = offers.retrieve({ filters: {}, tokens: [] });

  assert.deepEqual(atA[0].availability, {
    state: 'in_stock',
    confirmedAt: '2026-11-24T11:30:00.000Z',
  });
  assert.equal(atB[0].availability.state, 'out_of_stock');
  assert.equal(noLocation[0].availability, null);
  assert.equal(atA[0].priceCents, 12900);
});

test('price bounds use the offer price and availableOnly needs a fresh in-stock record', (t) => {
  const offers = setup(t);
  offers.publishOffer(offer({ priceCents: 15900 }));
  offers.recordAvailability(stock());
  const search = (extra) =>
    offers.retrieve({
      filters: { maximumPriceCents: 15000 },
      tokens: [],
      locationId: 'store-a',
      ...extra,
    });

  assert.deepEqual(search(), []);
  offers.publishOffer(offer({ sourceVersion: 2, priceCents: 12900 }));
  assert.equal(search().length, 1);
  assert.equal(
    search({ availableOnly: true, freshAfter: '2026-11-24T11:00:00.000Z' })
      .length,
    1,
  );
  assert.equal(
    search({ availableOnly: true, freshAfter: '2026-11-24T11:31:00.000Z' })
      .length,
    0,
  );
  assert.equal(
    search({ availableOnly: true, locationId: 'store-b' }).length,
    0,
  );
});

test('timestamps and identifiers are validated at ingestion', (t) => {
  const offers = setup(t);

  assert.throws(
    () => offers.publishOffer(offer({ updatedAt: '2026-11-24T12:06:00.000Z' })),
    /future/i,
  );
  assert.doesNotThrow(() =>
    offers.publishOffer(offer({ updatedAt: '2026-11-24T12:04:00.000Z' })),
  );
  assert.throws(() => offers.publishOffer(offer({ updatedAt: 'yesterday' })));
  assert.throws(() => offers.publishOffer(offer({ currency: 'usd' })));
  assert.throws(() => offers.publishOffer(offer({ sku: 'bad sku;' })));
  assert.throws(() => offers.publishOffer(offer({ sourceVersion: 0 })));
});
