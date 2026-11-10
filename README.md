# ShopSense API

[Architecture guide](docs/architecture.md) — source map, workflows, contracts, data, security, and checks.

## Repository layout and deployment boundary

This independent repository owns ShopSense AI's Node.js ESM API and authoritative SQLite state. The UI is the separate [shopsense-frontend](https://github.com/gopichand-retail-apps/shopsense-frontend) repository. Keep the current directory names, Git histories, origins, and independent builds.

The Vercel configuration belongs to the frontend only. This API has no verified Vercel deployment adapter. The local file database is not shared durable storage for stateless function instances. Do not deploy the local simulator as a public API or point it at real records.

Use Node **24.15.0**, npm, and the committed package-lock.json. From the full Retail Apps workspace, `./scripts/Start-Apps.ps1 -App ShopSenseAI` uses the correct built/native entry after setup. With the required sibling frontend available, install with `npm.cmd ci` and start with `npm.cmd start`; no API build is needed.

Health: http://127.0.0.1:5802/api/v1/health. Direct startup stores data under `data/shopsense.sqlite`; the workspace launcher can select a separate app-owned path. The [API contract](openapi.yaml) and [canonical architecture](docs/architecture.md) describe the existing routes and trust boundaries. The architecture guide is inside this repository.

The API reads its seed/content contract from the adjacent frontend at `../shopsense-frontend/public/shopsense-ai-model.json`. Clone both repositories as siblings before starting it; this existing file dependency is not a network integration. Backend configuration is read from process environment variables; creating a .env file alone does not load it.

Known release gaps: Shopper/catalog-editor identity and authorization are not established. Remote Unsplash images, formatting, generated-type ordering, and dialog-focus work remain. IT image smoke failed; do not label all checks passing.

The ShopSense API owns catalog reads, deterministic catalog-grounded recommendations, query-session fingerprints, feedback, and the local SQLite database. It exposes a versioned REST contract documented in [`openapi.yaml`](openapi.yaml).

## Run Locally

Use Node.js 22.13 or later.

```sh
npm ci
npm run dev
```

The API binds to `127.0.0.1:5802`. It creates `data/shopsense.sqlite` on first startup and seeds it from `../shopsense-frontend/public/shopsense-ai-model.json`. Set `SHOPSENSE_DB_PATH` to choose another local file. `SHOPSENSE_ALLOWED_ORIGINS` accepts a comma-separated list of explicit URL origins and replaces the model allowlist; it defaults to the model's local origins. API tests use in-memory SQLite.

## Endpoints

- `GET /api/v1/health`: service and storage readiness.
- `GET /api/v1/catalog?category=<id>`: catalog products with source attributes.
- `POST /api/v1/search`: validate a bounded query, rank catalog results, return matched details.
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

The local recommendation implementation does not require credentials or an external provider. The API has an origin allowlist and loopback binding, but no authentication or role authorization; do not expose it remotely until server-side identity and catalog-editor permissions are implemented.

See the [canonical architecture](docs/architecture.md), the [threat model](docs/architecture.md#8-security-privacy-and-egress), and the [frontend integration guide](https://github.com/gopichand-retail-apps/shopsense-frontend/blob/main/README.md).
