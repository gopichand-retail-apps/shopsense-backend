import assert from 'node:assert/strict';
import test from 'node:test';
import { groundSelection } from './grounding.mjs';

const product = {
  id: 'headphones',
  name: 'Stored name',
  priceCents: 12000,
  attributes: ['Closed back'],
  matchTags: ['quiet'],
};
const selection = {
  minimumPriceCents: null,
  maximumPriceCents: null,
  recommendations: [{ productId: product.id, evidenceIndexes: [0, 1, 1] }],
};
const ground = (value) =>
  groundSelection({ selection: value, products: [product], resultLimit: 2 });

test('only stored product fields and exact catalog evidence reach the result', () => {
  assert.deepEqual(ground(selection), [
    {
      product: { ...product, matchTags: undefined },
      matchedDetails: ['Closed back', 'quiet'],
    },
  ]);
  assert.deepEqual(ground({ ...selection, recommendations: [] }), []);
});

test('rejects fabricated IDs, evidence, duplicate products, price violations and excessive results', () => {
  for (const invalid of [
    { ...selection, minimumPriceCents: 20000, maximumPriceCents: 10000 },
    { ...selection, minimumPriceCents: 12001 },
    { ...selection, maximumPriceCents: 11999 },
    {
      ...selection,
      recommendations: [{ productId: 'fabricated', evidenceIndexes: [0] }],
    },
    {
      ...selection,
      recommendations: [{ productId: product.id, evidenceIndexes: [99] }],
    },
    {
      ...selection,
      recommendations: [{ productId: product.id, evidenceIndexes: [] }],
    },
    {
      ...selection,
      recommendations: [{ productId: product.id, evidenceIndexes: [0.5] }],
    },
    {
      ...selection,
      recommendations: [
        selection.recommendations[0],
        selection.recommendations[0],
      ],
    },
    {
      ...selection,
      recommendations: Array(3).fill(selection.recommendations[0]),
    },
  ])
    assert.throws(() => ground(invalid), { reason: 'invalid_response' });
  assert.equal(
    ground({ ...selection, minimumPriceCents: 12000, maximumPriceCents: 12000 })
      .length,
    1,
  );
});
