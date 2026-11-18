import pg from 'pg';
import { loadModel } from '../src/server.mjs';
import { loadSampleCatalog } from '../src/catalog/sample-catalog.mjs';
import { seedPostgresCatalog } from '../src/catalog/postgres-seed.mjs';
import { readStorageProfile } from '../src/catalog/storage-profile.mjs';

const profile = readStorageProfile();
if (profile.storage !== 'postgres' || !process.argv.includes('--apply')) {
  process.stderr.write(
    'Configure the private Postgres profile and explicitly pass --apply to import synthetic products.\n',
  );
  process.exitCode = 1;
} else {
  const pool = new pg.Pool({
    connectionString: profile.connectionString,
    ...(profile.ssl ? { ssl: profile.ssl } : {}),
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    const organizationId = await seedPostgresCatalog({
      pool,
      model: loadModel(),
      catalogProducts: loadSampleCatalog(),
      organizationId: profile.organizationId,
    });
    process.stdout.write(
      `Synthetic catalog imported for organization ${organizationId}; existing rows were preserved.\n`,
    );
  } catch {
    process.stderr.write(
      'Catalog import failed. Check the applied schema and private connection; no credentials are printed.\n',
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
