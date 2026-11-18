-- A server login for the loopback synthetic-store profile. This is not shopper authentication.
-- Credentials and the organization binding are provisioned separately from this desired schema.
create role shopsense_runtime nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
alter role shopsense_runtime connection limit 6;
alter role shopsense_runtime set statement_timeout = '5s';

create schema shopsense_private;
revoke all on schema shopsense_private from public, anon, authenticated;
grant usage on schema public, shopsense_private to shopsense_runtime;

create table shopsense_private.runtime_bindings (
  database_role name primary key,
  organization_id uuid not null references public.organizations(id)
);
create index runtime_bindings_organization_idx on shopsense_private.runtime_bindings(organization_id);
alter table shopsense_private.runtime_bindings enable row level security;
grant select on shopsense_private.runtime_bindings to shopsense_runtime;
create policy runtime_binding_read on shopsense_private.runtime_bindings for select to shopsense_runtime
  using (database_role = current_user);

grant select on public.categories, public.products to shopsense_runtime;
grant insert on public.query_sessions to shopsense_runtime;
grant insert, select(id) on public.recommendation_feedback to shopsense_runtime;
grant select, insert, update on public.ai_daily_usage to shopsense_runtime;

create policy category_runtime_read on public.categories for select to shopsense_runtime
  using (organization_id in (select b.organization_id from shopsense_private.runtime_bindings b));
create policy product_runtime_read on public.products for select to shopsense_runtime
  using (organization_id in (select b.organization_id from shopsense_private.runtime_bindings b));
create policy query_runtime_insert on public.query_sessions for insert to shopsense_runtime
  with check (user_id is null and organization_id in
    (select b.organization_id from shopsense_private.runtime_bindings b));
create policy feedback_runtime_insert on public.recommendation_feedback for insert to shopsense_runtime
  with check (user_id is null and organization_id in
    (select b.organization_id from shopsense_private.runtime_bindings b));
create policy feedback_runtime_read_id on public.recommendation_feedback for select to shopsense_runtime
  using (user_id is null and organization_id in
    (select b.organization_id from shopsense_private.runtime_bindings b));
create policy budget_runtime_read on public.ai_daily_usage for select to shopsense_runtime
  using (organization_id in (select b.organization_id from shopsense_private.runtime_bindings b));
create policy budget_runtime_insert on public.ai_daily_usage for insert to shopsense_runtime
  with check (organization_id in (select b.organization_id from shopsense_private.runtime_bindings b));
create policy budget_runtime_update on public.ai_daily_usage for update to shopsense_runtime
  using (organization_id in (select b.organization_id from shopsense_private.runtime_bindings b))
  with check (organization_id in (select b.organization_id from shopsense_private.runtime_bindings b));
