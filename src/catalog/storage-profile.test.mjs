import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openPostgresRepository,
  readStorageProfile,
} from './storage-profile.mjs';

const id = '11111111-1111-4111-8111-111111111111';
test('storage selection stays explicit and rejects unsafe or incomplete configuration', () => {
  assert.deepEqual(readStorageProfile({}), { storage: 'sqlite' });
  const profile = readStorageProfile({
    SHOPSENSE_STORAGE: 'postgres',
    DATABASE_URL: 'postgres://localhost/test',
    SHOPSENSE_ORGANIZATION_ID: id,
  });
  assert.equal(profile.storage, 'postgres');
  for (const environment of [
    { SHOPSENSE_STORAGE: 'bad' },
    { SHOPSENSE_STORAGE: 'postgres' },
    {
      SHOPSENSE_STORAGE: 'postgres',
      DATABASE_URL: 'bad',
      SHOPSENSE_ORGANIZATION_ID: id,
    },
    {
      SHOPSENSE_STORAGE: 'postgres',
      DATABASE_URL: 'https://localhost',
      SHOPSENSE_ORGANIZATION_ID: id,
    },
  ])
    assert.throws(() => readStorageProfile(environment));
});

test('opening Postgres verifies the connection and redacts failed credentials', async () => {
  let closed = false;
  class SuccessfulPool {
    async query() {
      return { rows: [] };
    }
    async end() {
      closed = true;
    }
  }
  const profile = {
    connectionString: 'postgres://private:secret@localhost/test',
    organizationId: id,
  };
  const repository = await openPostgresRepository(profile, SuccessfulPool);
  assert.equal(repository.storage, 'postgres');
  await repository.close();
  assert.equal(closed, true);
  class FailedPool extends SuccessfulPool {
    async query() {
      throw new Error('private database password');
    }
  }
  await assert.rejects(openPostgresRepository(profile, FailedPool), {
    message: 'Postgres is unavailable. Check private connection settings.',
  });
});

test('the database CA verifies TLS and cannot be overridden by connection-string SSL settings', async () => {
  const environment = {
    SHOPSENSE_STORAGE: 'postgres',
    DATABASE_URL:
      'postgres://runtime:synthetic@db.example.invalid/postgres?sslmode=verify-full&sslrootcert=untrusted',
    SHOPSENSE_ORGANIZATION_ID: id,
    SHOPSENSE_DATABASE_CA_FILE: 'certificates/supabase-prod-ca-2021.crt',
  };
  const profile = readStorageProfile(environment);
  assert.equal(profile.ssl.rejectUnauthorized, true);
  assert.match(profile.ssl.ca, /BEGIN CERTIFICATE/);
  assert.equal(
    new URL(profile.connectionString).searchParams.has('sslmode'),
    false,
  );
  assert.equal(
    new URL(profile.connectionString).searchParams.has('sslrootcert'),
    false,
  );
  let options;
  class Pool {
    constructor(configuration) {
      options = configuration;
    }
    async query() {
      return { rows: [] };
    }
    async end() {}
  }
  await (await openPostgresRepository(profile, Pool)).close();
  assert.equal(options.ssl, profile.ssl);
  assert.throws(
    () =>
      readStorageProfile({
        ...environment,
        DATABASE_URL: 'postgres://localhost/test?sslmode=disable',
      }),
    /full certificate verification/,
  );
  assert.throws(
    () =>
      readStorageProfile({
        ...environment,
        SHOPSENSE_DATABASE_CA_FILE: 'missing-certificate',
      }),
    /certificate could not be read/,
  );
});
