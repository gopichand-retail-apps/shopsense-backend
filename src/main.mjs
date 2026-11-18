import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { writeLog } from './observability/logging.mjs';
import { createApiServer } from './server.mjs';
import { loadSampleCatalog } from './catalog/sample-catalog.mjs';
import {
  readStorageProfile,
  openPostgresRepository,
} from './catalog/storage-profile.mjs';

const localEnvironmentPath = fileURLToPath(
  new URL('../.env.local', import.meta.url),
);
if (existsSync(localEnvironmentPath)) loadEnvFile(localEnvironmentPath);

const databasePath =
  process.env.SHOPSENSE_DB_PATH ??
  fileURLToPath(new URL('../data/shopsense.sqlite', import.meta.url));
const port = Number(process.env.PORT ?? 5802);
const storageProfile = readStorageProfile();
const repository =
  storageProfile.storage === 'postgres'
    ? await openPostgresRepository(storageProfile)
    : undefined;
const api = createApiServer({
  databasePath,
  catalogProducts: loadSampleCatalog(),
  repository,
});
let shuttingDown = false;

api.server.listen(port, '127.0.0.1', () => {
  writeLog({
    level: 'INFO',
    service: 'shopsense-api',
    environment: process.env.NODE_ENV ?? 'development',
    eventName: 'service.started',
    port,
    storage: storageProfile.storage,
  });
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  void api
    .close()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error) => {
      writeLog({
        level: 'ERROR',
        service: 'shopsense-api',
        environment: process.env.NODE_ENV ?? 'development',
        eventName: 'service.shutdown.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      process.exitCode = 1;
    });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
