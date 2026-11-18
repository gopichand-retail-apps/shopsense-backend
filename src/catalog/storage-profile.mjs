import pg from 'pg';
import { readFileSync } from 'node:fs';
import { createPostgresRepository } from './postgres.repository.mjs';

export function readStorageProfile(environment = process.env) {
  const storage = environment.SHOPSENSE_STORAGE ?? 'sqlite';
  if (!['sqlite', 'postgres'].includes(storage))
    throw new Error('Unknown ShopSense storage profile.');
  if (storage === 'sqlite') return { storage };
  const connectionString = environment.DATABASE_URL;
  const organizationId = environment.SHOPSENSE_ORGANIZATION_ID;
  if (
    !connectionString ||
    !organizationId ||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(organizationId)
  ) {
    throw new Error(
      'Postgres requires a server-only DATABASE_URL and organization UUID.',
    );
  }
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('Invalid Postgres connection configuration.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('Invalid Postgres connection configuration.');
  return { storage, organizationId, ...connectionProfile(url, environment) };
}

function connectionProfile(url, environment) {
  if (!environment.SHOPSENSE_DATABASE_CA_FILE)
    return { connectionString: url.toString() };
  const sslMode = url.searchParams.get('sslmode');
  if (sslMode && sslMode !== 'verify-full')
    throw new Error('A database CA requires full certificate verification.');
  for (const name of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'])
    url.searchParams.delete(name);
  try {
    return {
      connectionString: url.toString(),
      ssl: {
        ca: readFileSync(environment.SHOPSENSE_DATABASE_CA_FILE, 'utf8'),
        rejectUnauthorized: true,
      },
    };
  } catch {
    throw new Error(
      'The configured database CA certificate could not be read.',
    );
  }
}

export async function openPostgresRepository(profile, Pool = pg.Pool) {
  const pool = new Pool({
    connectionString: profile.connectionString,
    ...(profile.ssl ? { ssl: profile.ssl } : {}),
    max: 3,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10_000,
  });
  try {
    await pool.query('SELECT 1');
    return createPostgresRepository({
      pool,
      organizationId: profile.organizationId,
    });
  } catch {
    await pool.end();
    throw new Error(
      'Postgres is unavailable. Check private connection settings.',
    );
  }
}
