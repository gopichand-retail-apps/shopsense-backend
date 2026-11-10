import { z } from 'zod';

const stringList = z.array(z.string());
const stringMap = z.record(z.string(), z.string());
const productSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(160),
    brand: z.string().min(1).max(120),
    category: z.string().min(1).max(80),
    priceCents: z.number().int().nonnegative(),
    description: z.string().min(1).max(1000),
    imageUrl: z.string().min(1).max(500),
    imageAlt: z.string().min(1).max(240),
    attributes: stringList.max(40),
    matchTags: stringList.max(80),
  })
  .strict();

const contentModelSchema = z
  .object({
    version: z.number().int().positive(),
    appId: z.literal('shopsense-ai'),
    locale: z.string().min(2),
    messages: z
      .object({
        errors: z
          .object({
            invalidRequest: z.string().min(1),
            invalidSearch: z.string().min(1),
            notFound: z.string().min(1),
            originNotAllowed: z.string().min(1),
            payloadTooLarge: z.string().min(1),
            rateLimited: z.string().min(1),
            server: z.string().min(1),
          })
          .strict(),
        resultsFound: z.string().min(1),
        noResultsFor: z.string().min(1),
        localCatalogSource: z.string().min(1),
        categories: stringMap,
        intents: stringMap,
      })
      .catchall(z.string()),
    data: z
      .object({
        app: z
          .object({
            name: z.string().min(1),
            descriptor: z.string().min(1),
            description: z.string().min(1),
            apiBaseUrl: z.string().min(1),
            allowedOrigin: z.string().url(),
            allowedOrigins: z.array(z.string().url()).min(1).optional(),
            currency: z.string().length(3),
            themeStorageKey: z.string().min(1),
            savedStorageKey: z.string().min(1),
            defaultTheme: z.enum(['light', 'dark']),
          })
          .strict(),
        navigation: z
          .array(
            z
              .object({
                id: z.enum(['discover', 'saved']),
                label: z.string().min(1),
                icon: z.string().min(1),
              })
              .strict(),
          )
          .min(1),
        search: z
          .object({
            maximumQueryCharacters: z.number().int().min(3).max(2000),
            maximumBodyBytes: z.number().int().min(256).max(1_000_000),
            resultLimit: z.number().int().min(1).max(50),
            stopWords: stringList.max(500),
          })
          .strict(),
        quickPrompts: stringList.max(30),
        categories: z
          .array(
            z
              .object({
                id: z.string().min(1).max(80),
                label: z.string().min(1).max(120),
                aliases: stringList.max(80),
              })
              .strict(),
          )
          .min(1),
        seed: z
          .object({
            version: z.number().int().positive(),
            products: z.array(productSchema).min(1).max(500),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export function parseShopSenseModel(value) {
  const envelope = contentModelSchema.parse(value);
  return {
    modelVersion: envelope.version,
    app: { ...envelope.data.app, locale: envelope.locale },
    navigation: envelope.data.navigation,
    copy: envelope.messages,
    search: envelope.data.search,
    quickPrompts: envelope.data.quickPrompts,
    categories: envelope.data.categories,
    seed: envelope.data.seed,
  };
}
