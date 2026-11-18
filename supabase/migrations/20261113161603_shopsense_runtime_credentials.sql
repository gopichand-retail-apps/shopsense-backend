-- Supabase-only bootstrap. Generates the credential in the database; no literal secret enters history.
-- Keep Vault inaccessible to the application role. Never grant it access to decrypted_secrets.
do $$
declare
  runtime_password text;
begin
  select decrypted_secret into runtime_password from vault.decrypted_secrets
    where name = 'shopsense_runtime_database_password';
  if runtime_password is null then
    runtime_password := encode(extensions.gen_random_bytes(32), 'hex');
    perform vault.create_secret(runtime_password, 'shopsense_runtime_database_password',
      'Dedicated ShopSense synthetic-store database login. Not a shopper credential.');
  end if;
  execute format('alter role shopsense_runtime login password %L', runtime_password);
end $$;
