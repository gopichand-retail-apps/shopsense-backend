import { fileURLToPath } from 'node:url';
import { writeLog } from './observability/logging.mjs';
import { createApiServer } from './server.mjs';

const databasePath =
  process.env.SHOPSENSE_DB_PATH ??
  fileURLToPath(new URL('../data/shopsense.sqlite', import.meta.url));
const port = Number(process.env.PORT ?? 5802);
const api = createApiServer({ databasePath });
let shuttingDown = false;

api.server.listen(port, '127.0.0.1', () => {
  writeLog({
    level: 'INFO',
    service: 'shopsense-api',
    environment: process.env.NODE_ENV ?? 'development',
    eventName: 'service.started',
    port,
    storage: 'sqlite',
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
