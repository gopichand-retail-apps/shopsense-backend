import { createHmac, randomBytes } from 'node:crypto';
import { writeLog } from '../observability/logging.mjs';
import { aiCapabilities } from './configuration.mjs';
import { createGeminiProvider, ProviderError } from './gemini-provider.mjs';
import { groundSelection } from './grounding.mjs';
import { createOllamaProvider } from './ollama-provider.mjs';

export function createAiRecommendations({
  repository,
  model,
  local,
  configuration,
  provider,
  fallbackRecommendationProvider,
}) {
  const context = {
    repository,
    model,
    local,
    configuration,
    providers: [
      {
        name: configuration.provider,
        client:
          provider ??
          (configuration.provider === 'ollama'
            ? createOllamaProvider({ configuration })
            : createGeminiProvider({ configuration })),
      },
    ],
    capabilities: aiCapabilities(configuration),
    queryHashKey: randomBytes(32),
    inFlight: 0,
  };
  if (
    configuration.fallbackProvider === 'ollama' &&
    configuration.provider !== 'ollama'
  ) {
    context.providers.push({
      name: 'ollama',
      client:
        fallbackRecommendationProvider ??
        createOllamaProvider({ configuration }),
    });
  }
  return {
    recommend: (query, options) => recommend(context, query, options),
    capabilities: context.capabilities,
  };
}

async function recommend(
  context,
  query,
  { useAi = false, requestId, filters } = {},
) {
  if (!useAi)
    return {
      ...(await context.local.recommend(query, filters)),
      assistance: { status: 'catalog', provider: 'local' },
    };
  if (!context.capabilities.available)
    return fallback(context, query, 'not_configured', { requestId, filters });
  const retrieved = await context.local.retrieve(query, filters);
  if (!retrieved.ranked.length)
    return {
      ...(await context.local.recommend(query, filters)),
      assistance: { status: 'catalog', provider: 'local' },
    };
  if (context.inFlight >= context.configuration.maximumConcurrent)
    return fallback(context, query, 'busy', { requestId, filters });
  const day = new Date().toISOString().slice(0, 10);
  context.inFlight += 1;
  try {
    if (
      !(await context.repository.reserveAiRequest(
        day,
        context.configuration.dailyRequestLimit,
      ))
    ) {
      return fallback(context, query, 'budget', { requestId, filters });
    }
    return await completeSearch(context, query, {
      requestId,
      filters,
      retrieved,
    });
  } finally {
    context.inFlight -= 1;
  }
}

async function completeSearch(
  context,
  query,
  { requestId, filters, retrieved },
) {
  let reason = 'provider_error';
  for (const provider of context.providers) {
    try {
      const result = await selectGrounded(context, query, {
        provider,
        retrieved,
      });
      log(result.assistance.status, requestId);
      return result;
    } catch (error) {
      reason = error instanceof ProviderError ? error.reason : 'provider_error';
    }
  }
  return fallback(context, query, reason, { requestId, filters });
}

async function selectGrounded(context, query, { provider, retrieved }) {
  const { repository, model } = context;
  const products = retrieved.ranked.map((item) => item.product);
  const selection = await provider.client.select({
    query,
    products,
    resultLimit: model.search.resultLimit,
    currency: model.app.currency,
  });
  const results = groundSelection({
    selection,
    products,
    resultLimit: model.search.resultLimit,
  });
  await repository.recordQuery({
    queryHash: createHmac('sha256', context.queryHashKey)
      .update(query)
      .digest('hex'),
    intentCategory: null,
    resultCount: results.length,
  });
  const template = results.length
    ? model.copy.resultsFound
    : model.copy.noResultsFor;
  return {
    intentCategory: null,
    resultCount: results.length,
    results,
    summary: template
      .replace('{count}', String(results.length))
      .replace('{query}', query),
    source: model.copy.localCatalogSource,
    assistance: { status: 'assisted', provider: provider.name },
    totalMatches: retrieved.total,
    appliedFilters: retrieved.intent.filters,
  };
}

async function fallback(context, query, reason, { requestId, filters }) {
  log('unavailable', requestId, reason);
  return {
    ...(await context.local.recommend(query, filters)),
    assistance: { status: 'unavailable', provider: 'local', reason },
  };
}

function log(outcome, requestId, reason) {
  writeLog({
    level: outcome === 'unavailable' ? 'WARN' : 'INFO',
    service: 'shopsense-api',
    eventName: 'ai.recommendation.completed',
    outcome,
    requestId,
    ...(reason ? { errorCode: reason } : {}),
  });
}
