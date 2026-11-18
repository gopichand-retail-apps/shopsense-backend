import {
  buildRequest,
  ProviderError,
  readBoundedJson,
  selectionSchema,
} from './gemini-provider.mjs';

export function createOllamaProvider({ configuration, fetchImpl = fetch }) {
  return {
    async select(context) {
      const request = buildRequest({
        ...context,
        products: context.products.slice(0, 12),
      });
      try {
        const response = await fetchImpl(
          `${configuration.ollamaBaseUrl.replace(/\/$/, '')}/api/chat`,
          {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(configuration.ollamaTimeoutMs),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildOllamaBody(configuration, request)),
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new ProviderError(
            response.status === 429 ? 'quota' : 'provider_error',
          );
        }
        const payload = await readBoundedJson(response);
        if (payload?.done !== true) throw new ProviderError('invalid_response');
        return selectionSchema.parse(JSON.parse(payload.message?.content));
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        const invalid =
          error instanceof SyntaxError || error?.name === 'ZodError';
        throw new ProviderError(
          error?.name === 'TimeoutError'
            ? 'timeout'
            : invalid
              ? 'invalid_response'
              : 'provider_error',
        );
      }
    },
  };
}

function buildOllamaBody(configuration, request) {
  return {
    model: configuration.ollamaModel,
    stream: false,
    keep_alive: 0,
    messages: [
      { role: 'system', content: request.systemInstruction.parts[0].text },
      {
        role: 'user',
        content: request.contents[0].parts.map((part) => part.text).join('\n'),
      },
    ],
    format: request.generationConfig.responseJsonSchema,
    options: { temperature: 0, num_ctx: 4096, num_predict: 1024 },
  };
}
