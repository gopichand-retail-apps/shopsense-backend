# ShopSense AI Backend Architecture

Maintained in this independent Git repository at **docs/architecture.md**. Updated **2026-11-09**. The guide covers the implemented stack, interfaces, data model, operational limits, and release requirements.

## Contents

1. [Scope, users, and repository boundary](#1-scope-users-and-repository-boundary)
2. [Context, containers, and trust boundaries](#2-context-containers-and-trust-boundaries)
3. [Source ownership and module map](#3-source-ownership-and-module-map)
4. [Screens, navigation, and lifecycle](#4-screens-navigation-and-lifecycle)
5. [Primary workflows and recovery](#5-primary-workflows-and-recovery)
6. [Domain, persistence, and data ownership](#6-domain-persistence-and-data-ownership)
7. [API and internal contracts](#7-api-and-internal-contracts)
8. [Security, privacy, and egress](#8-security-privacy-and-egress)
9. [Design, accessibility, and platform adapters](#9-design-accessibility-and-platform-adapters)
10. [Build, checks, and deployment](#10-build-checks-and-deployment)
11. [Architecture decisions and tradeoffs](#11-architecture-decisions-and-tradeoffs)
12. [Requirements traceability](#12-requirements-traceability)
13. [Dated verification and limitations](#13-dated-verification-and-limitations)
14. [Extension rules and companion repository](#14-extension-rules-and-companion-repository)

## 1. Scope, users, and repository boundary

Catalog-grounded product discovery and comparison for shoppers.

Deterministic catalog matching, explanations, comparisons, browser-local saved IDs/theme, query sessions, and feedback. No external LLM is connected.

This repository owns the Node.js ESM API and SQLite state. UI rendering belongs to the separate frontend. The service validates and executes the domain operations described below.

There are two independent Git roots for this application, each with its own README and architecture guide. A parent app/workspace folder is a checkout convenience. Use synthetic records; current local services remain on loopback.

### Product Boundary

ShopSense AI supports catalog discovery and comparison for shoppers. Its local ranker is deterministic and only returns product data and matched attributes that exist in the catalog. There is no external recommendation provider, sign-in, or catalog-editor write endpoint in the current local implementation.

## 2. Context, containers, and trust boundaries

```mermaid
flowchart LR
  U["ShopSense AI user"] --> F["Next.js frontend - port 5801"]
  F -->|"API requests across an untrusted browser boundary"| A["Node.js ESM API - port 5802"]
  A --> D["SQLite - app-owned local persistence"]
  M["Validated public content model"] --> F
```

The API is the data authority, but only the identity/ownership controls actually implemented below can be relied on. CORS is not authentication.

### C4 Context

```mermaid
flowchart LR
    Shopper[Shopper]
    Workspace[ShopSense workspace]
    Catalog[Product catalog and local API]
    Identity[Future identity provider]
    Provider[Optional server-side provider]

    Shopper -->|Describe product need; compare; give feedback| Workspace
    Workspace -->|Validated catalog requests| Catalog
    Workspace -.->|Future account session| Identity
    Catalog -.->|Optional, bounded recommendation adapter| Provider
```

### C4 Containers and Current Data Flow

```mermaid
flowchart LR
    Browser[Next.js UI<br/>127.0.0.1:5801]
    Model[Strict versioned public model<br/>shopsense-ai-model.json]
    Web[Next.js server and same-origin rewrite]
    API[Node.js API<br/>127.0.0.1:5802]
    Validation[Allowed-origin and Zod validation]
    Ranking[Intent inference and ranking]
    Repository[Catalog repository]
    SQLite[(API-owned SQLite)]

    Browser -->|Copy, filter labels, synthetic catalog| Model
    Browser -->|/api/v1 request, JSON, request ID| Web
    Web -->|Rewrite to selected API origin| API
    API -->|Load seed model at startup| Model
    API --> Validation --> Ranking --> Repository
    Repository -->|Catalog reads, query fingerprints, feedback| SQLite
    SQLite --> Repository --> API
    API -->|Catalog-backed results and matched details| Browser
```

Trust boundaries: browser-to-Next.js (same-origin requests), Next.js-to-API (loopback rewrite), and API-to-database (only the API opens SQLite). The API validates the forwarded origin, schemas, and bounded request bodies. CORS is not authorization. The future provider boundary is server-only and disabled locally.

## 3. Source ownership and module map

| Owner/path                                                                                                                       | Responsibility                                                               |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [src/main.mjs](../src/main.mjs)<br>[src/server.mjs](../src/server.mjs)                                                           | Process bootstrap, HTTP composition, and configuration                       |
| [src/http/api-router.mjs](../src/http/api-router.mjs)                                                                            | HTTP route and request-adapter owners                                        |
| [src/recommendation.service.mjs](../src/recommendation.service.mjs)                                                              | Application workflow/state-machine owners                                    |
| [src/catalog.repository.mjs](../src/catalog.repository.mjs)                                                                      | Storage/transaction owners; memory where implemented                         |
| [src/types/model.schema.mjs](../src/types/model.schema.mjs)                                                                      | Validation/schema and migration authority                                    |
| [src/services/rate-limiter.mjs](../src/services/rate-limiter.mjs)                                                                | Existing session/role/limiter modules; their presence is not a hosting claim |
| [src/observability/logging.mjs](../src/observability/logging.mjs)                                                                | Safe errors, origin handling, or request correlation as implemented          |
| [openapi.yaml](../openapi.yaml)                                                                                                  | Published request/response contract source                                   |
| [.github/workflows](../.github/workflows)                                                                                        | Configured CI; hosted outcomes require separate verification                 |
| [src/catalog.repository.test.mjs](../src/catalog.repository.test.mjs)<br>[src/http/errors.test.mjs](../src/http/errors.test.mjs) | Examples of existing colocated tests                                         |

The source map follows the existing framework directories and test placement.

## 4. Screens, navigation, and lifecycle

This repository has no rendered screens. It supports the frontend through the HTTP/domain contracts in sections 5–7. Its lifecycle entry, response/error mapping, session behavior where present, and storage ownership are listed in section 3. Startup health is http://127.0.0.1:5802/api/v1/health; that configured address is not evidence of a running service. Persistent state is owned by this backend; preserve existing database files during changes.

## 5. Primary workflows and recovery

### Ten User Flows

The browser is not authenticated. Product state is catalog-owned; saved IDs and
appearance are browser-local; search fingerprints and feedback are API-owned.

#### 1. Open discovery

```mermaid
flowchart TD
    A[Open ShopSense] --> B[Fetch strict public content model]
    B --> C{Model valid and appId matches?}
    C -->|No| D[Show visible bootstrap error code]
    C -->|Yes| E[Read theme and saved product IDs]
    E --> F[GET health and catalog]
    F --> G{API available?}
    G -->|No| H[Show safe retryable service state]
    G -->|Yes| I[Render catalog-backed products]
```

#### 2. Submit a product need

```mermaid
flowchart TD
    A[Enter a natural-language need] --> B[Trim and validate query length]
    B --> C{Query valid?}
    C -->|No| D[Show model-backed field error]
    C -->|Yes| E[POST search with request ID]
    E --> F[API validates bounded JSON]
    F --> G[Infer intent and rank catalog rows]
    G --> H[Persist only keyed query metadata]
    H --> I[Return catalog results and matched details]
```

#### 3. Infer catalog intent

```mermaid
flowchart TD
    A[Normalize query tokens] --> B[Remove configured stop words]
    B --> C[Match category labels and aliases]
    C --> D{Category intent found?}
    D -->|Yes| E[Restrict candidate catalog category]
    D -->|No| F[Search all catalog products]
    E --> G[Continue to product scoring]
    F --> G
```

#### 4. Retrieve catalog items

```mermaid
flowchart TD
    A[Receive validated intent] --> B[Read products from API-owned SQLite]
    B --> C[Apply optional category filter]
    C --> D[Load stored names, descriptions, tags, attributes]
    D --> E[Continue with catalog-only ranking]
```

#### 5. Rank grounded matches

```mermaid
flowchart TD
    A[Candidate products] --> B[Match query to stored product fields]
    B --> C[Score category, tag, and attribute matches]
    C --> D[Sort deterministically]
    D --> E[Apply configured result limit]
    E --> F[Return catalog product records]
```

#### 6. Explain a match

```mermaid
flowchart TD
    A[Select ranked result] --> B[Collect matching stored attributes and tags]
    B --> C[Deduplicate and cap explanation details]
    C --> D{Verified details matched?}
    D -->|Yes| E[Show matched catalog attributes]
    D -->|No| F[Show the stored category label]
```

#### 7. Compare products

```mermaid
flowchart TD
    A[Select compare] --> B{Already selected?}
    B -->|Yes| C[Remove from selection]
    B -->|No| D{Two products already selected?}
    D -->|Yes| E[Keep current selection and explain limit]
    D -->|No| F[Add catalog product ID]
    C --> G[Render side-by-side catalog fields]
    F --> G
```

#### 8. Save a product

```mermaid
flowchart TD
    A[Select save] --> B[Update saved product IDs]
    B --> C[Persist IDs in this browser localStorage]
    C --> D[Announce save or remove]
    D --> E[Open saved list]
    E --> F[Resolve saved IDs against loaded catalog]
```

#### 9. Send feedback

```mermaid
flowchart TD
    A[Choose helpful or not relevant] --> B[POST product ID and boolean]
    B --> C[API validates feedback schema]
    C --> D{Product still exists?}
    D -->|No| E[Return safe not-found error]
    D -->|Yes| F[Persist minimal feedback event]
    F --> G[Return accepted status]
    G --> H[Show confirmation]
```

#### 10. Recover from no match or API failure

```mermaid
flowchart TD
    A[Search returns empty or fails] --> B{No results or transport error?}
    B -->|No results| C[Explain no close catalog match]
    B -->|Error| D[Show safe error; keep query in the search field]
    C --> E[Back to discovery clears query and restores quick prompts]
    D --> F[Resubmit the current query]
    F --> G{Request succeeds?}
    G -->|No| D
    G -->|Yes| H[Replace results and restore workspace]
```

### Use-Case Preconditions, State, and Recovery

These are the implemented local workflows; planned identity, editor, and
provider integrations are not prerequisites and are not represented as current
behavior.

| Use case                          | Actor and preconditions                                                             | State/data changes                                                                                                     | Failure and recovery                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Open discovery                    | Shopper; Next.js UI and strict model are reachable.                                 | Reads theme/saved IDs from this browser; requests health and catalog.                                                  | Invalid model shows `CONTENT_MODEL_UNAVAILABLE`; API errors show safe retryable catalog state.             |
| Submit product need               | Shopper; trimmed query is 3–240 characters and body is within the model byte limit. | API ranks current catalog and stores a keyed fingerprint plus minimal query metadata; raw text is not stored.          | Validation/rate/API errors use safe model copy; query remains available for another submit.                |
| Infer catalog intent              | API internal step; validated query and category aliases exist.                      | No separate write; stop words are removed and category ID is inferred or remains `null`.                               | Unknown intent searches all catalog products rather than fabricating a category.                           |
| Retrieve catalog items            | API internal step; optional category must be in the model.                          | Reads products and their stored attributes from SQLite.                                                                | Invalid categories return `INVALID_CATEGORY`; UI can clear the filter or retry.                            |
| Rank grounded matches             | API internal step; retrieved rows are the only candidates.                          | Deterministic field/tag/attribute/category scores, stable name tie-break, configured result cap.                       | Zero scores produce a no-match response with no product.                                                   |
| Explain a match                   | API internal step; candidate has stored attributes/tags or a configured category.   | Returns at most three distinct matched details, falling back only to a stored category label.                          | With no verified details or label, returns an empty detail list; no generated claim is added.              |
| Compare products                  | Shopper; products are in the loaded catalog.                                        | Compare IDs stay in component state; at most two product records are rendered side by side.                            | Third selection is disabled and the limit is explained; remove/clear to choose another pair.               |
| Save a product                    | Shopper; product is in the loaded catalog.                                          | Stable product ID is stored in browser `localStorage`; no account or API write.                                        | Corrupt storage is ignored and reset to an empty list; removed catalog IDs are omitted from display.       |
| Send feedback                     | Shopper; product ID and helpful/not-relevant choice are supplied.                   | API verifies product existence and inserts a minimal feedback record.                                                  | Safe validation/not-found/API copy; buttons remain available when the request fails.                       |
| Recover from no match/API failure | Shopper; current search and model copy are available.                               | No-match “Back to discovery” clears the active search; offline state tracks browser connectivity and reconnect health. | Catalog retry refreshes health/data; search may be resubmitted; safe errors do not expose backend details. |

## 6. Domain, persistence, and data ownership

The API owns the current persistence boundary. Keep database engines, schema/migration order, exact-money rules where applicable, and transaction invariants consistent with executable source.

### Data Ownership and ERD

```mermaid
erDiagram
    CATEGORY ||--o{ PRODUCT : classifies
    PRODUCT ||--o{ RECOMMENDATION_FEEDBACK : receives
    QUERY_SESSION {
      string id PK
      string query_hash
      string intent_category
      int result_count
      datetime created_at
    }
    CATEGORY {
      string id PK
      int display_order
    }
    PRODUCT {
      string id PK
      string category FK
      int price_cents
      string attributes_json
      string match_tags_json
    }
    RECOMMENDATION_FEEDBACK {
      string id PK
      string product_id FK
      boolean helpful
      datetime created_at
    }
```

The API owns `categories`, `products`, `query_sessions`, and `recommendation_feedback`. Product and category seeds come from the public content model. New query-session fingerprints use HMAC-SHA-256 with a random process-local key; the raw query is not stored or logged, and fingerprints do not correlate across restarts. Existing databases created before that change may still contain legacy unkeyed hashes. Product prices use integer cents. SQLite constraints and parameterized repository statements protect local invariants. The initial seed is atomic, but the schema currently uses `CREATE TABLE IF NOT EXISTS` and has no versioned migration system. Because seed inserts ignore conflicts, replace the local SQLite file after changing seed product/category data. Tests use in-memory SQLite; the running API stores its file in `shopsense-backend/data/`.

## 7. API and internal contracts

The repository contract is [openapi.yaml](../openapi.yaml). Keep public paths, status/error envelopes, headers, payload validation, and compatibility tied to that source.

### API Contract

| Method | Route              | Request                     | Result                                      |
| ------ | ------------------ | --------------------------- | ------------------------------------------- |
| GET    | `/api/v1/health`   | None                        | Service and SQLite readiness                |
| GET    | `/api/v1/catalog`  | Optional validated category | Catalog rows and stored attributes          |
| POST   | `/api/v1/search`   | Bounded `{ query }`         | Ranked catalog products and matched details |
| POST   | `/api/v1/feedback` | `{ productId, helpful }`    | Persisted feedback acceptance               |

Success responses use `{ data }`; failures use `{ error: { code, message, requestId } }`. The complete request/response contract is in [`shopsense-backend/openapi.yaml`](../openapi.yaml). `X-Request-ID` and `X-Trace-ID` are returned on responses; request IDs are included in structured logs. Request bodies and raw queries are not logged.

## 8. Security, privacy, and egress

Current release limitation: **Shopper/catalog-editor identity and authorization are not established. Remote Unsplash images, formatting, generated-type ordering, and dialog-focus work remain. IT image smoke failed; do not label all checks passing.**

### Authorization and API Ownership Matrix

The local API has no authenticated principals, shopper accounts, roles, or
catalog-editor capability. The allowlisted `Origin` check is a browser boundary,
not authentication or authorization. Loopback binding is the current exposure
limit.

| Route            | Current actor and authorization                                                             | Reads/writes                                                                                    | Expected failures and recovery                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`    | Any local caller; no identity check. Health is excluded from rate limiting.                 | Reports API/SQLite readiness; no domain write.                                                  | Safe internal error; restart/check local database if unavailable.                                                            |
| `GET /catalog`   | Unauthenticated local browser or caller; optional category must exist in the public model.  | Reads catalog rows from API-owned SQLite.                                                       | `INVALID_CATEGORY`, `ORIGIN_NOT_ALLOWED`, or `RATE_LIMITED`; correct the filter or retry later.                              |
| `POST /search`   | Unauthenticated local browser or caller; strict JSON, bounded body, query length 3–240.     | Reads catalog; stores only a keyed fingerprint, inferred category, result count, and timestamp. | `INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `INVALID_SEARCH`, `RATE_LIMITED`, or safe `INTERNAL_ERROR`; keep the query and retry.   |
| `POST /feedback` | Unauthenticated local browser or caller; strict product ID and boolean; product must exist. | Reads product, then inserts minimal feedback.                                                   | `INVALID_FEEDBACK`, `PRODUCT_NOT_FOUND`, `RATE_LIMITED`, or safe `INTERNAL_ERROR`; retry the feedback action if appropriate. |
| Other paths      | No route or elevated actor exists.                                                          | No domain read/write.                                                                           | Safe `NOT_FOUND` response.                                                                                                   |

`SHOPSENSE_ALLOWED_ORIGINS` may replace the model origin list. The process-local
rate limiter defaults to 120 requests per minute per remote address, excluding
health. It is not a distributed quota or identity control.

### Integrations, Modes, and Observability

| Integration or mode        | Current behavior                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product catalog            | Synthetic catalog seeded from the versioned public model into API-owned SQLite.                                                                                                             |
| Recommendation provider    | No external LLM/provider is called. Ranking is deterministic and local.                                                                                                                     |
| Identity and authorization | Not implemented. No user/account or editor role is accepted.                                                                                                                                |
| Mock mode                  | `NEXT_PUBLIC_IS_MOCK=true` selects the configured mock API origin. The local mock path still calls the same REST API and uses seeded synthetic data; it is not an in-browser fake response. |
| Live mode                  | `NEXT_PUBLIC_IS_MOCK=false` selects `SHOPSENSE_REAL_API_URL`. E2E uses the isolated local API as the selected endpoint; this does not prove a production/third-party integration.           |
| Telemetry                  | API emits JSON request/startup events with request/trace IDs, route template, method, status, duration, outcome, and safe error code. It omits request bodies and raw queries.              |

Keep private credentials out of public models, browser bundles, logs, URLs, and source archives. The existing remote Unsplash image dependency remains; no external LLM is connected. Keep logs limited to the source-defined request/trace and safe aggregate fields. Backups, retention, deletion, and real-user ownership need explicit product/operations decisions before external exposure.

## 9. Design, accessibility, and platform adapters

There is no visual rendering or native package in this API repository. Preserve safe errors and stable contracts so the frontend can present accessible recovery states. Hardware scanning, banking/payment rails, shipping providers, and native integrations remain limited to what the current source actually implements; simulator behavior is not device/provider integration.

## 10. Build, checks, and deployment

Configured npm scripts, from this repository with Node **24.15.0**; use `npm.cmd` in PowerShell:

| Command                    | Actual manifest definition                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run dev`          | `node --watch src/main.mjs`                                                                                                                                                                  |
| `npm.cmd run start`        | `node src/main.mjs`                                                                                                                                                                          |
| `npm.cmd run test`         | `node --test`                                                                                                                                                                                |
| `npm.cmd run test:cov`     | `c8 --all --include="src/**/*.mjs" --exclude="src/**/*.test.mjs" --exclude="src/main.mjs" --check-coverage --lines 90 --branches 90 --functions 90 --statements 90 --reporter=text npm test` |
| `npm.cmd run check`        | `node --check src/main.mjs && node --check src/server.mjs`                                                                                                                                   |
| `npm.cmd run lint`         | `eslint src`                                                                                                                                                                                 |
| `npm.cmd run format:check` | `prettier --check "src/**/*.mjs" "eslint.config.mjs" ".github/workflows/*.yml" "openapi.yaml"`                                                                                               |

Install with `npm.cmd ci` and retain [package-lock.json](../package-lock.json). Registry access is required for a clean dependency installation. These commands describe the configured checks; execution results are listed in section 13.

The API remains loopback-only. Direct-start storage is `data/shopsense.sqlite` relative to this repository. The adjacent `../shopsense-frontend/public/shopsense-ai-model.json` file is a required seed/content input; process environment variables are read, and a .env file is not loaded automatically.

CI configuration is listed in section 3. Run the configured checks before merging or releasing. Deployment requires separate verification of the selected hosting environment.

## 11. Architecture decisions and tradeoffs

### Implemented Design Patterns and Invariants

- The application is a local modular monolith, not a set of independently
  deployed microservices. The frontend is a presentation/client-state boundary;
  the API is the only SQLite client.
- The backend request path is HTTP handler -> route/schema validation ->
  recommendation service -> repository. The ranker is a deterministic domain
  service; it has no external model dependency.
- One strict `version/appId/locale/messages/data` model feeds frontend copy and
  synthetic seed data. Both frontend and backend validate it at their trust
  boundary. The old public architecture model and UI route are removed.
- Catalog reads and writes use a repository boundary, parameterized SQL,
  foreign keys, constraints, and an atomic transaction for initial seed data.
  `INSERT OR IGNORE` preserves existing rows; it does not migrate changed seed
  content into an existing local database.
- Recommendation explanations are assembled only from matched stored
  attributes/tags or the stored category label. Sorting is deterministic and
  results are capped by the model.
- The browser owns only saved product IDs, appearance preference, active search,
  and compare selection. Saved IDs resolve against the latest catalog; compare
  selection is capped at two and is not persisted.
- New query records contain a keyed HMAC fingerprint, inferred category,
  result count, and timestamp. The key is random and process-local; raw queries
  and request bodies are not persisted or logged. A transaction writes the
  seed, but query and feedback events are independent inserts.
- API failures use a stable, model-backed error code/message/request-ID
  envelope. Unexpected internal details are not returned to the browser.

The two Git repositories remain separate. Each owns one maintained README and this repository-local architecture guide. Shared application behavior may be described here for contract context, but implementation changes belong to the owning source module.

## 12. Requirements traceability

| Capability                       | Acceptance                                                        | Owner/path                         | Current status                                                | Evidence                               | Risk                                                                                                                                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository-local architecture    | Guide available in this checkout and linked from README           | docs/architecture.md; README.md    | Documented and validated                                      | File, link, and diagram checks         | Keep documentation consistent with source changes                                                                                                                                                                         |
| API composition and domain state | Preserve existing workflows and failure states                    | src/server.mjs and source map      | Implemented; application verification limits are listed below | Current source and existing app design | Shopper/catalog-editor identity and authorization are not established. Remote Unsplash images, formatting, generated-type ordering, and dialog-focus work remain. IT image smoke failed; do not label all checks passing. |
| Public deployment                | Verified identity, data durability, recovery, and hosted behavior | Existing deployment/API boundaries | Needs separate hardening/verification                         | No new hosted evidence                 | Local checks do not establish production readiness                                                                                                                                                                        |

## 13. Dated verification and limitations

Last documentation review: **2026-11-09**. The checks below distinguish documentation validation from application and deployment testing.

- Repository-local guide, README link, source-path references, section/contents anchors, and Mermaid syntax: passed documentation validation.
- New application tests/builds, coverage, dependency audits, browser/device accessibility/performance, hosted CI, and Vercel deployment: **not rerun for the documentation updates**.
- Frontend production builds passed on 2026-11-09 with Node 24.15.0. Build success does not establish that all application quality gates pass.
- Outstanding baseline limit: Shopper/catalog-editor identity and authorization are not established. Remote Unsplash images, formatting, generated-type ordering, and dialog-focus work remain. IT image smoke failed; do not label all checks passing.

The baseline results below record earlier validation. Re-run the listed commands against the current revision before release.

Previously recorded application verification:

### Verification and Known Gaps

Run the API from `shopsense-backend` and the UI from `shopsense-frontend` in
separate terminals. Use Node.js 22.13 or later.

```sh
cd shopsense-backend
npm ci
npm run dev
```

```sh
cd shopsense-frontend
npm ci
npm run dev
```

Backend checks: `npm run format:check`, `npm run lint`, `npm run check`,
`npm test`, `npm run test:cov`, and `npm audit`. Frontend checks:
`npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test:unit`,
`npm run test:cov`, `npm audit`, and both `npm run test:e2e` and
`NEXT_PUBLIC_IS_MOCK=false npm run test:e2e`. Unit/API tests use synthetic
fixtures and in-memory SQLite. Playwright builds into an ignored test directory,
uses ports 5881/5882, and starts an in-memory SQLite API; it does not reuse
services or databases on ports 5801/5802. Coverage gates require at least 90%
for statements, branches, functions, and lines.

Known gaps: no identity/role/record ownership, no catalog editor, no
versioned SQLite migration or seed-update workflow, no distributed rate limit,
no persistent HMAC key rotation, no TLS, and no real external provider. Keep
both local services loopback-only and use synthetic data until these controls
are implemented and verified.

## 14. Extension rules and companion repository

Start with [README.md](../README.md) and this guide. The companion repository is [shopsense-frontend](https://github.com/gopichand-retail-apps/shopsense-frontend); clone the pair as siblings when using the existing local integration/model contract. This guide is inside the current repository and does not depend on a parent-folder architecture file to exist.

Update this guide when owned source, routes, persistence, identity, UI states, egress, or deployment behavior changes. Coordinate public contract changes with the companion repository and tests. Preserve existing data, run isolated checks with synthetic records, record failures, and review release and infrastructure changes before publication.
