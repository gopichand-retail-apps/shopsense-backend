-- Declarative schema, not an applied migration. Auth UI/onboarding are separate release gates.
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 160),
  created_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner', 'editor', 'employee')),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members(user_id, organization_id);

create table public.categories (
  organization_id uuid not null references public.organizations(id),
  id text not null,
  display_order integer not null,
  primary key (organization_id, id)
);

create table public.products (
  organization_id uuid not null references public.organizations(id),
  id text not null check (length(id) between 1 and 80),
  name text not null,
  brand text not null,
  category text not null,
  price_cents integer not null check (price_cents >= 0),
  description text not null,
  image_url text not null,
  image_alt text not null,
  attributes_json jsonb not null check (jsonb_typeof(attributes_json) = 'array'),
  match_tags_json jsonb not null check (jsonb_typeof(match_tags_json) = 'array'),
  display_order integer not null,
  color text check (color in ('black', 'white', 'navy', 'red', 'green', 'blue')),
  audience text check (audience in ('women', 'men', 'kids', 'unisex')),
  product_type text,
  search_document tsvector generated always as (
    to_tsvector('simple'::regconfig, name || ' ' || brand || ' ' || description || ' ' ||
      attributes_json::text || ' ' || match_tags_json::text)
  ) stored,
  primary key (organization_id, id),
  foreign key (organization_id, category) references public.categories(organization_id, id)
);
create index products_facets_idx on public.products(organization_id, product_type, color, audience);
create index products_category_idx on public.products(organization_id, category, display_order);
create index products_search_idx on public.products using gin(search_document);

create table public.query_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid references auth.users(id),
  query_hash text not null,
  intent_category text,
  result_count integer not null check (result_count >= 0),
  created_at timestamptz not null default now()
);
create index query_sessions_owner_idx on public.query_sessions(organization_id, user_id, created_at);

create table public.recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid references auth.users(id),
  product_id text not null,
  helpful boolean not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, product_id) references public.products(organization_id, id)
);
create index feedback_owner_idx on public.recommendation_feedback(organization_id, user_id);
create index feedback_product_idx on public.recommendation_feedback(organization_id, product_id);

create table public.ai_daily_usage (
  organization_id uuid not null references public.organizations(id),
  day date not null,
  request_count integer not null check (request_count >= 0),
  primary key (organization_id, day)
);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.query_sessions enable row level security;
alter table public.recommendation_feedback enable row level security;
alter table public.ai_daily_usage enable row level security;

revoke all on public.organizations, public.organization_members, public.categories, public.products,
  public.query_sessions, public.recommendation_feedback, public.ai_daily_usage from anon, authenticated;
grant select on public.organizations, public.organization_members, public.categories, public.products to authenticated;
grant insert, update, delete on public.products to authenticated;
grant select on public.query_sessions to authenticated;
grant select, insert on public.recommendation_feedback to authenticated;

create policy membership_self_read on public.organization_members for select to authenticated
  using (user_id = (select auth.uid()));
create policy organization_member_read on public.organizations for select to authenticated
  using (exists (select 1 from public.organization_members m
    where m.organization_id = organizations.id and m.user_id = (select auth.uid())));
create policy category_member_read on public.categories for select to authenticated
  using (exists (select 1 from public.organization_members m
    where m.organization_id = categories.organization_id and m.user_id = (select auth.uid())));
create policy product_member_read on public.products for select to authenticated
  using (exists (select 1 from public.organization_members m
    where m.organization_id = products.organization_id and m.user_id = (select auth.uid())));
create policy product_editor_insert on public.products for insert to authenticated
  with check (exists (select 1 from public.organization_members m where m.organization_id = products.organization_id
    and m.user_id = (select auth.uid()) and m.role in ('owner', 'editor')));
create policy product_editor_update on public.products for update to authenticated
  using (exists (select 1 from public.organization_members m where m.organization_id = products.organization_id
    and m.user_id = (select auth.uid()) and m.role in ('owner', 'editor')))
  with check (exists (select 1 from public.organization_members m where m.organization_id = products.organization_id
    and m.user_id = (select auth.uid()) and m.role in ('owner', 'editor')));
create policy product_editor_delete on public.products for delete to authenticated
  using (exists (select 1 from public.organization_members m where m.organization_id = products.organization_id
    and m.user_id = (select auth.uid()) and m.role in ('owner', 'editor')));
create policy query_owner_read on public.query_sessions for select to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.organization_members m
    where m.organization_id = query_sessions.organization_id and m.user_id = (select auth.uid())));
create policy feedback_owner_read on public.recommendation_feedback for select to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.organization_members m
    where m.organization_id = recommendation_feedback.organization_id and m.user_id = (select auth.uid())));
create policy feedback_owner_insert on public.recommendation_feedback for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.organization_members m
    where m.organization_id = recommendation_feedback.organization_id and m.user_id = (select auth.uid())));

-- No anonymous policies. Membership changes and AI budgets are server-controlled.
-- The local privileged repository is loopback-only until real API identity/tenant checks are implemented.
