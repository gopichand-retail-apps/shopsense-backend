import { z } from 'zod';

const configurationSchema = z.object({
  provider: z.enum(['local', 'gemini', 'ollama']).default('local'),
  fallbackProvider: z.enum(['none', 'ollama']).default('none'),
  apiKey: z.string().trim().default(''),
  model: z
    .string()
    .regex(/^gemini-[a-z0-9.-]+$/)
    .default('gemini-3.1-flash-lite'),
  timeoutMs: z.coerce.number().int().min(100).max(30_000).default(8000),
  dailyRequestLimit: z.coerce.number().int().min(1).max(1000).default(50),
  maximumConcurrent: z.coerce.number().int().min(1).max(5).default(2),
  ollamaModel: z
    .string()
    .regex(/^[a-zA-Z0-9._:/-]+$/)
    .default('gemma4:latest'),
  ollamaBaseUrl: z
    .string()
    .url()
    .default('http://127.0.0.1:11434')
    .refine(isLoopback),
  ollamaTimeoutMs: z.coerce
    .number()
    .int()
    .min(100)
    .max(120_000)
    .default(30_000),
});

export function readAiConfiguration(environment = process.env) {
  return configurationSchema.parse({
    provider: environment.SHOPSENSE_AI_PROVIDER,
    apiKey: environment.GEMINI_API_KEY,
    model: environment.GEMINI_MODEL,
    timeoutMs: environment.SHOPSENSE_AI_TIMEOUT_MS,
    dailyRequestLimit: environment.SHOPSENSE_AI_DAILY_REQUEST_LIMIT,
    maximumConcurrent: environment.SHOPSENSE_AI_MAX_CONCURRENT,
    fallbackProvider: environment.SHOPSENSE_AI_FALLBACK_PROVIDER,
    ollamaModel: environment.OLLAMA_MODEL,
    ollamaBaseUrl: environment.OLLAMA_BASE_URL,
    ollamaTimeoutMs: environment.OLLAMA_TIMEOUT_MS,
  });
}

export function aiCapabilities(configuration) {
  const available =
    configuration.provider === 'ollama' ||
    (configuration.provider === 'gemini' && Boolean(configuration.apiKey));
  return { available, provider: available ? configuration.provider : 'local' };
}

function isLoopback(value) {
  const url = new URL(value);
  return (
    url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
    url.pathname === '/' &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  );
}
