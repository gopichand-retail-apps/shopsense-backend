# ShopSense API

![CI](https://github.com/gopichand-retail-apps/shopsense-backend/actions/workflows/ci.yml/badge.svg)

[Architecture guide](docs/architecture.md) — source map, workflows, contracts, data, security, and checks.

## Repository layout and deployment boundary

This independent repository owns ShopSense AI's Node.js ESM API and authoritative catalog state (default SQLite, optional Postgres). The UI is the separate [shopsense-frontend](https://github.com/gopichand-retail-apps/shopsense-frontend) repository. Keep the current directory names, Git histories, origins, and independent builds.

The Vercel configuration belongs to the frontend only. This API has no verified Vercel deployment adapter. The local file database is not shared durable storage for stateless function instances. Do not expose the unauthenticated local API publicly or point it at real customer records.

Use Node **24.15.0**, npm, and the committed package-lock.json. From the full Retail Apps workspace, `./scripts/Start-Apps.ps1 -App ShopSenseAI` uses the correct built/native entry after setup. Install with `npm.cmd ci` and start with `npm.cmd start`; no API build is needed.

Health: http://127.0.0.1:5802/api/v1/health. Direct startup stores data under `data/shopsense.sqlite`; the workspace launcher can select a separate app-owned path. The [API contract](openapi.yaml) and [canonical architecture](docs/architecture.md) describe the existing routes and trust boundaries. The architecture guide is inside this repository.

The API reads its deployment-owned seed/content snapshot from `data/shopsense-ai-model.json`. It starts and tests without a sibling checkout. After intentional frontend content changes, run `node scripts/sync-content-model.mjs` with both repos present; `--check` detects drift. Review and commit the snapshot with the API. The entrypoint loads the ignored backend `.env.local`; process environment variables take precedence. Never put provider keys in the frontend or public model.

Known release gaps: Shopper/catalog-editor identity and authorization are not established. Most merchandise artwork remains illustrative. Comparison keyboard focus is verified in the frontend; full accessibility remains unmeasured. Formatting and generated-type ordering were corrected on November 13, 2026. IT image smoke failed; do not label all checks passing.

The ShopSense API owns catalog reads, deterministic catalog-grounded recommendations, query-session fingerprints, feedback, and the local SQLite database. It exposes a versioned REST contract documented in [`openapi.yaml`](openapi.yaml).

## Run Locally

### Optional Gemini or local Ollama search

Copy `.env.example` to the ignored `.env.local`, then set `GEMINI_API_KEY` locally. Keep
`SHOPSENSE_AI_PROVIDER=gemini` and select a model available to the project. `npm.cmd start`, `npm.cmd run dev`,
and the workspace launcher load the private file; process environment variables take precedence.
The key never belongs in the frontend, a `NEXT_PUBLIC_*` variable, or the public model.

`POST /api/v1/search` accepts optional `useAi: true`; omitted/false retains catalog-only API compatibility. The shopper UI always sends true. Optional strict audience/color/maximum-price facets intersect with parsed query constraints.
`GET /api/v1/health` reports `ai.available` and `ai.provider`. Search responses include `assistance`
with `catalog`, `assisted`, or `unavailable` status. The server resolves model selections to stored products
and evidence; timeouts, invalid outputs, exhausted quotas, and budgets return an explicitly labeled fallback.

Defaults are an 8-second timeout, 2 concurrent calls per process, and 50 attempts per UTC day persisted in
the selected database. These are usage controls, not a monetary cap. A bounded synthetic catalog shortlist and shopper query are sent to
Google when Gemini is selected; free-tier data may be used for product improvement. Do not send personal information.

Run `npm.cmd run check:ai` for real provider discovery plus price/no-match pipeline checks using an isolated
in-memory database. Empty retrieval can finish without calling AI. This is
deliberately separate from CI, which uses provider doubles and never needs a key. See
[architecture and hosted milestones](docs/architecture.md#catalog-voice-ai-and-hosted-release-path---november-13-2026).

Use workspace Node.js 24.15.0.

```sh
npm ci
npm run dev
```

The API binds to `127.0.0.1:5802`. It creates `data/shopsense.sqlite` on first startup and seeds it from `data/shopsense-ai-model.json`. Set `SHOPSENSE_DB_PATH` to choose another local file. `SHOPSENSE_ALLOWED_ORIGINS` accepts a comma-separated list of explicit URL origins and replaces the model allowlist; it defaults to the model's local origins. API tests use in-memory SQLite.

## Endpoints

- `GET /api/v1/health`: service and storage readiness.
- `GET /api/v1/catalog?category=<id>&limit=24&offset=0`: bounded catalog pages; optional comma-separated `ids` resolves saved products.
- `POST /api/v1/search`: validate a bounded query and optional facets, rank catalog results, return matched details.
- `GET /api/v1/store-layout`: versioned virtual aisles/racks; product locations are derived from this source-controlled artifact.
- `POST /api/v1/feedback`: persist a product ID and helpful/not-relevant response.

Errors use `{ "error": { "code", "message", "requestId" } }`. Request IDs are returned in `X-Request-ID` and included in structured JSON request logs. New query-session fingerprints use HMAC-SHA-256 with a random process-local key, so they do not correlate across restarts. Raw prompts are not persisted or logged. Older local databases may contain legacy unkeyed hashes; replace such a database if its previous prompts could be sensitive.

## Checks

```sh
npm run format:check
npm run lint
npm run check
npm test
npm run test:cov
npm audit
```

`npm run test:cov` includes source files and enforces at least 90% statements,
branches, functions, and lines. Repository, request-schema, and API error paths
run against isolated or in-memory SQLite.

The default catalog ranker does not require credentials. Gemini selection requires a server key and is requested automatically by the shopper UI, with a visible data-use disclosure and explicit provider/fallback attribution. The API has an origin allowlist and loopback binding, but no authentication or role authorization; do not expose it remotely until server-side identity and catalog-editor permissions are implemented.

See the [canonical architecture](docs/architecture.md), the [threat model](docs/architecture.md#8-security-privacy-and-egress), and the [frontend integration guide](https://github.com/gopichand-retail-apps/shopsense-frontend/blob/main/README.md).

## Catalog and optional Postgres profile

Startup adds 300 examples to the eight preserved originals: 30 each of dresses, shirts, pants, shoes,
headphones, earbuds, bottles, mugs, sunglasses, and backpacks. New records and their 50 reused SVG
illustrations are synthetic. `npm.cmd run catalog:generate` reproduces `data/catalog.sample.json` and
the sibling frontend assets. Existing IDs are preserved. The public UI model does not contain all 308 rows.

Search applies parameterized color/audience/type/price filters before ranking. Gemini receives at most
36 candidates; Ollama receives at most 12. The app never asks a model to invent prices or stock.

Set `SHOPSENSE_AI_PROVIDER=ollama`, a loopback `OLLAMA_BASE_URL`, and an installed `OLLAMA_MODEL` for local
inference. Optional `SHOPSENSE_AI_FALLBACK_PROVIDER=ollama` enables Gemini-to-Ollama recovery. Both default
to labeled catalog fallback on failure. The adapter does not start Ollama or download weights. Tests use
provider doubles; real local inference remains unrun. The active local profile remains Gemini.

The declarative `supabase/schemas/shopsense.sql` and async pg adapter support an optional Postgres profile.
Set `SHOPSENSE_STORAGE=postgres`, private `DATABASE_URL`, and `SHOPSENSE_ORGANIZATION_ID` only after schema
and connection verification. `npm.cmd run catalog:seed:postgres -- --apply` explicitly imports synthetic
data transactionally without overwriting existing records. The dedicated shopsense-ai project now holds the 308-row import. The running API role cannot import
or edit products; use a separate private operator connection for this command.

Local PGlite tests verify schema/import, rollback, pagination/search, organization/role isolation, allowed
editor updates, WITH CHECK, and self-promotion denial. The active API now uses a restricted NOBYPASSRLS runtime role bound to one store. Hosted negative checks
verify store isolation and denied catalog/binding/Vault access. It still has no authenticated shopper
principal; do not expose this fixed-organization synthetic profile publicly. Supabase Auth, company onboarding, storage upload, and hosted API authorization are unfinished.

Earlier November 13 verification: 75 backend tests passed with 99.9% statements/lines, 97.29% branches, and 100% functions. See the [November 17 release record](docs/releases/2026-11-17-customer-discovery.md) for the current customer-discovery checks.
See the maintained architecture for the complete release sequence and current limits.

## Active Supabase profile

Dedicated project: [shopsense-ai](https://supabase.com/dashboard/project/ixotpmxfdhgooqmybnpk), us-east-1,
quoted $0/month. The existing retail-apps project is untouched. The ignored .env.local selects Postgres;
.env.supabase.local retains the private connection profile. No credential is committed or sent to browsers.
The runtime login is bound in shopsense_private.runtime_bindings, with no product/membership write or RLS
bypass. Human identity and company onboarding are not implemented, so both app services remain on loopback.

The public certificate at certificates/supabase-prod-ca-2021.crt came from
https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt. SHA-256 fingerprint:
80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA.
It expires April 26, 2031. SHOPSENSE_DATABASE_CA_FILE enables verified TLS, strips conflicting URL SSL
parameters, and never disables verification. This file is a public trust anchor, not a private key.

The three migration files were exported from the actual hosted migration history after applying the
tested schema, role isolation, and Supabase Vault credential bootstrap. The bootstrap generates its
password inside Postgres; migration source contains no credential literal. Local schema tests use PGlite;
full Supabase CLI reset/replay has not been verified. Generate future changes from desired schema and
review them before applying; preserve applied history. Return to the preserved SQLite file by selecting
SHOPSENSE_STORAGE=sqlite and restarting. No database was deleted during the profile switch.

## Customer-discovery verification — November 17, 2026

The shopper UI always requests configured AI selection; the strict API preserves omitted/false `useAi`
for existing catalog-only callers. Optional audience/color/maximum-price facets intersect with parsed
query constraints. Empty retrieval makes no model call and reserves no AI budget. The verified Gemini
default is `gemini-3.1-flash-lite`; provider timeout/quota/failure still produces labeled catalog recovery.

`data/store-layout.json` and `data/catalog-photos.json` add versioned virtual locations and reference-photo
enrichment during retrieval. They do not alter database rows, merchant inventory, schema, RLS, or applied
migrations. The latest recorded backend suite passes **81 tests**, with **99.91% statements/lines**,
**97.53% branches**, and **100% functions**. See the
[release record](docs/releases/2026-11-17-customer-discovery.md) for paired frontend/E2E evidence and open release gates.
