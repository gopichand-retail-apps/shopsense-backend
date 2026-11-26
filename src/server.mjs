import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createCatalogRepository } from './catalog.repository.mjs';
import { handleApiRequest } from './http/request-handler.mjs';
import { createRecommendationService } from './recommendation.service.mjs';
import { createRateLimiter } from './services/rate-limiter.mjs';
import { parseShopSenseModel } from './types/model.schema.mjs';
import { readAiConfiguration } from './ai/configuration.mjs';
import { createAiRecommendations } from './ai/recommendations.mjs';
import { withStoreLayout } from './catalog/store-layout.mjs';
import { readOfferConfiguration } from './offers/configuration.mjs';
import { createOfferDiscovery } from './offers/offer-discovery.mjs';
import { seedOffers } from './offers/offer-feed.mjs';

export { routeTemplate } from './http/request-metadata.mjs';

const modelPath = fileURLToPath(
  new URL('../data/shopsense-ai-model.json', import.meta.url),
);
const allowedOriginsSchema = z.array(z.string().url()).min(1);

export function loadModelEnvelope() {
  return JSON.parse(readFileSync(modelPath, 'utf8'));
}

export function loadModel() {
  return parseShopSenseModel(loadModelEnvelope());
}

function resolveAllowedOrigins(model) {
  const configuredOrigins = process.env.SHOPSENSE_ALLOWED_ORIGINS;
  if (configuredOrigins === undefined)
    return model.app.allowedOrigins ?? [model.app.allowedOrigin];
  return configuredOrigins.split(',').map((origin) => origin.trim());
}

export function createApiServer({
  databasePath = 'data/shopsense.sqlite',
  model: modelEnvelope = loadModelEnvelope(),
  allowedOrigins: originOverride,
  aiConfiguration = readAiConfiguration(),
  recommendationProvider,
  catalogProducts = [],
  repository: repositoryOverride,
  ...offerOptions
} = {}) {
  const model = parseShopSenseModel(modelEnvelope);
  const allowedOrigins = allowedOriginsSchema.parse(
    originOverride ?? resolveAllowedOrigins(model),
  );
  if (databasePath !== ':memory:')
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });

  const rateLimit = createRateLimiter({
    limit: Number(process.env.API_RATE_LIMIT_MAX ?? 120),
    windowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS ?? 60_000),
  });
  const services = composeServices({
    model,
    baseRepository:
      repositoryOverride ??
      createCatalogRepository({
        databasePath,
        model,
        catalogProducts,
        now: offerOptions.now,
      }),
    aiConfiguration,
    recommendationProvider,
    ...offerOptions,
  });
  const { repository } = services;
  const server = createServer((request, response) => {
    void handleApiRequest({
      request,
      response,
      model,
      ...services,
      allowedOrigins,
      rateLimit,
    });
  });

  return {
    server,
    close: () => closeApiServer(server, repository),
  };
}

function composeServices({
  model,
  baseRepository,
  aiConfiguration,
  recommendationProvider,
  now = () => new Date(),
  offerConfiguration = readOfferConfiguration(),
  offerFeed = offerConfiguration.feed,
}) {
  seedOffers(baseRepository, offerFeed, { model, now });
  const repository = withStoreLayout(baseRepository);
  const withProvider = (local) =>
    createAiRecommendations({
      repository,
      model,
      local,
      configuration: aiConfiguration,
      provider: recommendationProvider,
    });
  const offerDiscovery = baseRepository.offers
    ? createOfferDiscovery({
        repository: baseRepository,
        model,
        now,
        maxAgeMinutes: offerConfiguration.maxAgeMinutes,
      })
    : null;
  return {
    repository,
    recommendations: withProvider(
      createRecommendationService({ repository, model }),
    ),
    offerDiscovery,
    offerRecommendations: offerDiscovery ? withProvider(offerDiscovery) : null,
  };
}

function closeApiServer(server, repository) {
  return new Promise((resolveClose, reject) => {
    server.close(async (error) => {
      try {
        await repository.close();
        if (error) reject(error);
        else resolveClose();
      } catch (closeError) {
        reject(closeError);
      }
    });
    server.closeAllConnections();
  });
}
