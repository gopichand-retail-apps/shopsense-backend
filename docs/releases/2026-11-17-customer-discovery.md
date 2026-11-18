# ShopSenseAI customer-discovery release record

**Record updated:** November 17, 2026. **Scope:** ShopSenseAI only; two independent repositories.
This is a deliberate feature/fix increment, not an archive reconstruction or production certification.
Earlier local evidence was generated on November 16 using workspace Node 24.15.0 on Windows/PowerShell.

## Customer story and implementation

A shopper describes an item, refines collection/color/budget, receives grounded product matches, finds
their virtual aisle/rack/shelf, saves candidates on this device, and compares two items using the keyboard.

- Shopper searches request the configured AI provider automatically; the developer-style AI checkbox is
  removed. The expandable disclosure explains query/catalog transfer and browser speech behavior.
- Strict audience/color/maximum-price facets intersect with parsed query constraints before retrieval.
  Contradictions return no matches. Models choose only retrieved IDs and stored evidence; they do not
  invent products, prices, availability, or locations. Empty retrieval spends no provider reservation.
- New searches, cancel, clear, and unmount discard obsolete responses. Failure retains editable text and
  explicit retry/fallback messaging. Browser cancellation does not guarantee cancellation of accepted
  server/provider work.
- Results show returned/total counts and product facts. The results view removes the decorative hero
  panel and keeps mobile search controls usable. Saved IDs remain browser-local.
- Comparison traps focus, makes the background inert, locks body scrolling, and restores trigger focus.
  Store-guide layout loads on expansion with retry and cancellation.
- Backend runtime and backend CI use the deployment-owned `data/shopsense-ai-model.json` snapshot.
  `scripts/sync-content-model.mjs` is an authoring helper when both repos are available.

## Data, images, and virtual store

The catalog still contains **308 illustrative products**: eight preserved originals and 300 generated
examples. It is not merchant stock. The local API's existing private profile uses Supabase Postgres with
verified TLS and a restricted role fixed to one synthetic store. Human HTTP identity is unfinished.

`data/store-layout.json` defines an original versioned virtual store. Retrieval decorates products with
aisle/rack/shelf labels. `GET /api/v1/store-layout` exposes the guide. Placements are derived from a source
artifact, not persisted physical-store placements, a copied retailer blueprint, or real stock availability.
This customer-discovery increment changes **no database schema, RLS policy, or applied migration**.

Three downloaded local JPEGs cover matching black shirts, women's black dresses, and black headphones.
The manifest records sources, photographer attribution, Pexels license links, byte sizes, and SHA-256
checksums; the frontend labels these as style references. Only matching illustrative `sample-*` products
receive overrides. Unknown merchant IDs retain their fields. Most catalog artwork remains SVG
illustrations; original remote imagery remains. These photos do not establish a merchant relationship,
exact SKU appearance, or real-world availability. Controlled merchant import/object storage is future work.

## Recorded checks

Run commands in the relevant repository with workspace Node 24.15.0 first on PATH; use `npm.cmd` in
PowerShell. Check ports with workspace `scripts/check-ports.mjs` before server-based checks. Isolated
Playwright uses loopback 5881/5882, in-memory SQLite, and local/provider doubles. It does not reuse the
normal local services or contact a real model for each scenario.

| Check | Recorded result | Evidence and limits |
| --- | --- | --- |
| Frontend `npm.cmd run test:cov` | Passed: 59 tests | 96.52% statements; 92.32% branches; 97.46% functions; 98.19% lines. Existing gates unchanged. |
| Backend `npm.cmd run test:cov` | Passed: 88 tests | 99.91% statements; 97.46% branches; 100% functions; 99.91% lines. Existing gates unchanged. |
| `node scripts/test-e2e.mjs`, mock API selector | Passed: 27 scenarios | Synthetic memory DB; provider doubles/catalog ranking; 23.4 seconds. |
| `NEXT_PUBLIC_IS_MOCK=false` with the same E2E runner | Passed: 27 scenarios | Selected-origin routing check, not production or hosted AI certification; 22.7 seconds. |
| Responsive browser scenarios | Passed at 320, 390, 768, 1440px | No horizontal overflow; desktop/390px screenshots inspected. These checks are not real-device certification. |
| Comparison keyboard flow | Passed | Initial focus, Tab/Shift+Tab trapping, Escape, trigger restoration. Full accessibility remains unmeasured. |
| Three downloaded photograph hashes | Passed | Bytes/checksums match the reviewed manifest. Coverage is partial. |
| Separate prior `npm.cmd run check:ai` with Gemini 3.1 Flash-Lite | Passed | One actual provider-assisted semantic search; price/no-match pipeline checks completed locally without a model call. |
| Rebuilt browser → Next rewrite → API → Supabase → Gemini | Passed | Actual Gemini-assisted filtered search in 2,714ms; two black men's shirts at $24, A2/R2/shelf 1. Photos, save/reload, comparison keyboard, accepted feedback, 390px layout, virtual guide, no-match, and no browser exceptions passed. |
| GitHub CI / PR merge / Vercel release | Pending | Exact commit, checks, URL/protection, and deployment results must be appended after verification. |

The configured Gemini 3.5 Flash-Lite generation returned HTTP 503/high demand during diagnosis. Gemini
3.1 Flash-Lite returned structured selections successfully and passed the separate smoke command, so
the private local profile and source default were changed to `gemini-3.1-flash-lite`. A successful smoke
does not guarantee provider availability or a free production allowance. Existing 8-second timeout,
two-concurrent-call bound, 50 daily reservations, and explicit fallback remain.

Local raw evidence is under workspace `.runtime/shopsense-checks/`: frontend coverage
`customer-frontend-coverage-20261116.log`, backend `customer-backend-final-20261116.log`, and browser
`customer-e2e-mock-pass-20261116.log` / `customer-e2e-live-selector-20261116.log`. Those machine-local
artifacts are not release-source dependencies and contain no required credentials.

## Remaining release gates

The current app is a local discovery workflow. Merchant stock, cart, checkout, payments, receipts,
user-owned server history/lists, company onboarding, and authenticated editor capabilities are not
implemented. Physical microphone capture, real Ollama inference, full WCAG assessment, production load,
latency/Core Web Vitals, migration replay/restore, and hosted recovery remain unverified.

The API has no verified Vercel request adapter or human authorization boundary. Fixed-store database
RLS, CORS, headers, and noindex do not supply HTTP identity. Keep services on loopback until the hosted
access design and relevant denial tests are implemented and measured. No production readiness claim
follows from this local pass.

For publication, scan the complete proposed source/assets and available history without including ignored
private profiles. Preserve concurrent work. Merge the additive backend API contract first: the previous
backend main rejects `useAi`. Then pin the frontend CI companion checkout to the tested backend commit,
run paired checks, and record exact PR/merge revisions. Deployment must use durable Postgres, packaged
content, server-only secrets, explicit HTTPS routing, protected access, and verified customer smoke checks.

## November 17 final customer QA increment

- Fixed a real category transition defect: leaving a search now restores the prior browse category and
  its pagination context. All-category paging after that transition returns distinct records.
- Fixed store-guide close/reopen recovery after an initial fetch error.
- Closed mobile navigation is hidden from pointer, visual, and keyboard interaction after desktop resize.
- Added bounded English need matching for wedding/formal outfits, insulated cold-drink containers, and
  noise-reducing audio. These rules require recorded product evidence. Explicit types, prices, colors,
  audiences, and supported feature negations remain constraints. This is reviewed intent expansion,
  not embeddings or unrestricted semantic interpretation.
- Real browser requests without request interception found Trail Bottle for “something to keep my drink
  cold” (2,604ms) and Studio Headphones for “something to block out noise on my commute” (1,661ms),
  both with assistance.status=assisted/provider=gemini and stored supporting attributes.
- The first live-provider request timed out at about 8.2 seconds and correctly returned an explicit
  catalog fallback. A cold Supabase request also exceeded a 5-second browser assertion; the live
  harness now allows 15 seconds for hosted data. These successful samples are not p95 measurements.
- Feedback POST returned 201/accepted=true. A separate post-restart SELECT using the restricted runtime
  role was denied (42501), as its least-privilege policy intends. No grant was expanded for QA and no
  fresh November 17 readback-persistence claim is made; earlier dated persistence evidence is historical.

Evidence: workspace .runtime/shopsense-checks/live-customer-evidence-20261117.json,
live-customer-timeout-evidence-20261117.json, live-everyday-evidence-20261117.json,
customer-frontend-final-20261117.log and customer-backend-release-20261117.log. Browser scenarios
use isolated Playwright Chromium, not the person's signed-in Chrome profile. Physical microphone and
real-device tests remain unrun.

### Security recheck before publication

The earlier zero-advisory audit was superseded by a fresh November 17 registry check. The build detected
Next.js advisories GHSA-mfr8-8qww-v76h and GHSA-vc7v-qv4w-wrv8 affecting 16.4.3. The frontend and
eslint-config-next are being patched together to 16.4.6. The full frontend audit also reports the newly
reviewed high-severity picomatch advisory GHSA-fc5q-39xc-vjpf through development-tool dependencies.
The advisory lists no patched version; 4.0.7 is the newest published npm release. An attempted 4.0.8
override failed ETARGET and was removed. No dependency gate is lowered, advisory hidden, or forced
toolchain downgrade applied. Frontend CI/release must retain this unresolved finding.
The independent backend fresh npm audit passes with zero findings.

Sources: [Next.js 16.4.6](https://github.com/vercel/next.js/releases/tag/v16.4.6),
[Next.js cache advisory](https://github.com/advisories/GHSA-mfr8-8qww-v76h),
[nested cache advisory](https://github.com/advisories/GHSA-vc7v-qv4w-wrv8),
[unpatched picomatch advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
