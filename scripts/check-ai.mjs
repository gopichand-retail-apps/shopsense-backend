import { once } from 'node:events';
import { createApiServer } from '../src/server.mjs';
import {
  readAiConfiguration,
  aiCapabilities,
} from '../src/ai/configuration.mjs';
import { loadSampleCatalog } from '../src/catalog/sample-catalog.mjs';

const configuration = readAiConfiguration();
if (!aiCapabilities(configuration).available) {
  process.stderr.write(
    'Gemini is not configured. Set the backend private environment file.\n',
  );
  process.exitCode = 1;
} else {
  const api = createApiServer({
    databasePath: ':memory:',
    aiConfiguration: configuration,
    catalogProducts: loadSampleCatalog(),
  });
  try {
    api.server.listen(0, '127.0.0.1');
    await once(api.server, 'listening');
    const origin = `http://127.0.0.1:${api.server.address().port}`;
    for (const [name, query] of [
      ['semantic-discovery', 'Something to carry my things on a weekend hike'],
      ['price-constraint', 'A bag under $20'],
      ['no-match', 'A purple titanium telescope for whales'],
    ]) {
      const response = await fetch(`${origin}/api/v1/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, useAi: true }),
      });
      const payload = await response.json();
      const result = payload.data;
      const passed =
        response.ok &&
        (result?.assistance?.status === 'assisted' ||
          (name !== 'semantic-discovery' &&
            result?.assistance?.status === 'catalog')) &&
        (name === 'semantic-discovery'
          ? result.resultCount > 0
          : result.resultCount === 0);
      process.stdout.write(
        `${JSON.stringify({
          check: name,
          passed,
          provider: result?.assistance?.provider,
          reason: result?.assistance?.reason,
          resultCount: result?.resultCount,
        })}\n`,
      );
      if (!passed) process.exitCode = 1;
    }
  } catch {
    process.stderr.write(
      'AI check failed; credentials and provider details are intentionally omitted.\n',
    );
    process.exitCode = 1;
  } finally {
    await api.close();
  }
}
