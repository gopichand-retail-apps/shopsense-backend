import { ProviderError } from './gemini-provider.mjs';

export function groundSelection({ selection, products, resultLimit }) {
  const { minimumPriceCents: minimum, maximumPriceCents: maximum } = selection;
  if (minimum !== null && maximum !== null && minimum > maximum) {
    throw new ProviderError('invalid_response');
  }
  if (selection.recommendations.length > resultLimit)
    throw new ProviderError('invalid_response');
  const seen = new Set();
  return selection.recommendations.map((item) => {
    const product = products.find((row) => row.id === item.productId);
    if (!product || seen.has(item.productId))
      throw new ProviderError('invalid_response');
    seen.add(item.productId);
    if (
      (minimum !== null && product.priceCents < minimum) ||
      (maximum !== null && product.priceCents > maximum)
    )
      throw new ProviderError('invalid_response');
    const evidence = [...product.attributes, ...product.matchTags];
    const indexes = [...new Set(item.evidenceIndexes)];
    if (
      !indexes.length ||
      indexes.some((index) => !Number.isInteger(index) || !evidence[index])
    ) {
      throw new ProviderError('invalid_response');
    }
    return {
      product: { ...product, matchTags: undefined },
      matchedDetails: indexes.map((index) => evidence[index]),
    };
  });
}
