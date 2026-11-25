export const SAMPLE_MERCHANT_ID = 'synthetic-merchant-1';
const SAMPLE_OFFER_UPDATED_AT = '2026-11-23T00:00:00.000Z';
const MINUTE_MS = 60_000;
const STALE_AGE_MINUTES = 3 * 1440;
const sampleLocations = [
  { id: 'store-a', name: 'Northside Store' },
  { id: 'store-b', name: 'Riverside Store' },
];

// Deterministic synthetic stock plans. Each plan returns null for "no record".
function planStoreA(index) {
  const slot = index % 8;
  if (slot === 7) return null;
  return {
    state: slot === 6 ? 'out_of_stock' : 'in_stock',
    ageMinutes: 10 * ((index % 5) + 1),
  };
}

function planStoreB(index) {
  if (index % 13 === 4) return null;
  if (index % 11 === 5)
    return { state: 'in_stock', ageMinutes: STALE_AGE_MINUTES };
  return {
    state: index % 3 === 0 ? 'out_of_stock' : 'in_stock',
    ageMinutes: 15 * ((index % 4) + 1),
  };
}

const plans = { 'store-a': planStoreA, 'store-b': planStoreB };

export function buildSampleFeed({
  products,
  now,
  currency,
  merchantId = SAMPLE_MERCHANT_ID,
}) {
  const ordered = [...products].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const offers = [];
  const availability = [];
  ordered.forEach((product, index) => {
    const sku = `SYN-${product.id}`;
    offers.push({
      merchantId,
      sku,
      productId: product.id,
      sourceVersion: 1,
      priceCents: product.priceCents,
      currency,
      updatedAt: SAMPLE_OFFER_UPDATED_AT,
    });
    for (const [locationId, plan] of Object.entries(plans)) {
      const entry = plan(index);
      if (!entry) continue;
      availability.push({
        merchantId,
        sku,
        locationId,
        state: entry.state,
        confirmedAt: new Date(
          now.getTime() - entry.ageMinutes * MINUTE_MS,
        ).toISOString(),
        sourceVersion: 1,
      });
    }
  });
  return { locations: sampleLocations, offers, availability };
}

function tally(results) {
  const counts = {};
  for (const { outcome } of results)
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  return counts;
}

export function applyFeed(store, feed) {
  return store.batch(() => {
    store.upsertLocations(feed.locations);
    return {
      offers: tally(feed.offers.map((offer) => store.publishOffer(offer))),
      availability: tally(
        feed.availability.map((item) => store.recordAvailability(item)),
      ),
    };
  });
}
