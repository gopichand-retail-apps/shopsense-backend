import { readFileSync } from 'node:fs';
import { applyCatalogPhoto } from './catalog-photos.mjs';

export const storeLayout = JSON.parse(
  readFileSync(
    new URL('../../data/store-layout.json', import.meta.url),
    'utf8',
  ),
);
const apparelRacks = ['dress', 'shirt', 'pants', 'shoes'];
const shelfColors = ['black', 'white', 'navy', 'red', 'green', 'blue'];

export function locateProduct(product) {
  product = applyCatalogPhoto(product);
  const aisle = storeLayout.aisles.find(
    (item) =>
      item.category === product.category &&
      (!item.audience || item.audience === (product.audience ?? 'unisex')),
  );
  if (!aisle) return product;
  const position = apparelRacks.indexOf(product.productType);
  const rack =
    product.category === 'apparel' && aisle.id !== 'A4' && position >= 0
      ? position + 1
      : product.productType === 'earbuds'
        ? 2
        : 1;
  return {
    ...product,
    location: {
      storeId: storeLayout.id,
      layoutVersion: storeLayout.version,
      virtual: true,
      aisle: aisle.id,
      rack: `R${rack}`,
      shelf: Math.max(1, shelfColors.indexOf(product.color) + 1),
    },
  };
}

export function withStoreLayout(repository) {
  const wrapped = { ...repository };
  for (const name of ['catalogPage', 'retrieveProducts', 'listProducts']) {
    if (!repository[name]) continue;
    wrapped[name] = async (...args) =>
      (await repository[name](...args)).map(locateProduct);
  }
  wrapped.getProduct = async (id) => {
    const product = await repository.getProduct(id);
    return product ? locateProduct(product) : null;
  };
  return wrapped;
}
