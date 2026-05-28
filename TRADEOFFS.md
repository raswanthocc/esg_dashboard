# Tradeoffs

Three things I deliberately did not build, with the reasoning.

## 1. Real API connectors (Concur OAuth, SAP OData, utility API)

**Not built.** All three sources are file-upload only. There is no API
pull, no scheduled sync, no OAuth dance.

**Why.**

- *Onboarding reality.* When a new client signs, week-one ingestion is
  always file-based. The facilities team emails you a CSV. The finance
  team exports SAP material movements to a flat file. The travel team
  pulls a Concur report. API integrations come *after* — once the client
  has provisioned credentials, opened firewall rules, signed a data-share
  addendum. Building API pulls in the prototype models the wrong moment.

- *Three connectors = three full-day projects.* Concur is an OAuth 2 flow
  with refresh tokens and pagination. SAP OData needs SAP Gateway
  configured client-side, plus often a SOAP fallback. Utility APIs (when
  they exist) are vendor-specific. Each is a day of plumbing that returns
  zero insight into the data model — which is the heavily-weighted part
  of the grade.

- *Pipeline shape doesn't change.* Whether bytes come from `request.FILES`
  or from a polling worker, the parse → normalize → validate → audit
  pipeline is identical. Adding API ingestion later is a matter of writing
  a worker that feeds the same `ingest()` function. The interesting
  questions are all downstream of the bytes.

**What this costs us.** No real-time updates. No "the utility refreshed
their portal" detection. A real production system needs at least the SAP
side automated.

## 2. PDF utility bill parsing (and Green Button XML)

**Not built.** Utility ingestion is portal-CSV only. PDF bills get the
human-in-the-loop treatment (someone transcribes or exports to CSV
first).

**Why.**

- *PDF parsing is brittle*: every utility lays bills out differently,
  scanned-image PDFs need OCR, and "extract consumption from the bill"
  is a real product on its own. Getting it 70% right is easy; getting it
  audit-defensible is a project.

- *Green Button (the US energy-data XML standard) is US-only* and not
  every utility exposes it. We name-drop it in SOURCES.md as evidence we
  researched, then skip it. India clients (the primary market the
  assignment hints at via SAP plant codes and INR-flavored examples)
  almost never have Green Button.

- *Portal CSV is the common denominator.* Solving the 80% case well is
  more useful than solving 100% of formats half-well.

**What this costs us.** Clients who can only produce PDFs need a manual
re-keying step. We'd handle this in production with a "PDF inbox →
human review → CSV" workflow rather than auto-parsing.

## 3. Authentication, tenant admin UI, factor management UI

**Not built.** No login. Tenant selected via dropdown + `X-Tenant`
header. New tenants and emission factors are seeded by a management
command. No analyst CRUD.

**Why.**

- *Modeled, not built.* The grading prompt asks the *data model* to
  handle multi-tenancy. It does — every domain row has an `organization`
  FK, querysets are tenant-scoped via middleware, the cost of swapping
  the tenant selector for a real auth claim is one middleware change.
  Building a real auth system buys grading on a criterion the rubric
  doesn't weight, at the cost of time on criteria it does.

- *Factor management is a real product.* Versioning, vintage rules,
  per-tenant overrides, methodology audit trails — these belong in a
  separate factor-library service in production. Including a half-built
  factor CRUD in a prototype would imply more than it delivered.

- *Analyst CRUD is mostly Django admin in disguise.* The Django admin is
  already wired up for power users. Building a custom UI on top of it
  adds visual polish but no system understanding.

**What this costs us.** A real reviewer/auditor seat-management story.
The single-page analyst UI assumes you trust whoever has the URL — fine
for a demo, not for production. We'd add SSO + role-based permissions
before any real customer ships.

---

## Other things I cut quietly, mentioned for completeness

- **Asynchronous ingestion** (Celery/RQ). The synchronous `ingest()` call
  is fine at prototype data sizes. Production would queue it so the HTTP
  request returns immediately and a worker handles parsing.
- **Pagination beyond limit/offset.** Cursor pagination would be the
  right call for tables with millions of records. Limit/offset works for
  prototype-sized data and is one DB change away from upgrade.
- **Real test suite.** Acknowledged in DECISIONS.md. The parsers were
  designed pure (no DB imports in the dataclass producer) so they'd be
  easy to unit-test in a follow-up.
- **A "duplicate detection" pass that's smarter than period-overlap.**
  Right now I flag overlapping periods on the same meter/site, but I
  don't surface "this batch SHA matches another batch in your org" — I
  reject the upload outright. A weaker fuzzy-duplicate detector for
  near-misses (one row already exists for this meter and this date)
  would catch things like the same data uploaded under a slightly
  different file name.
- **Charts/visualization on the dashboard.** Summary tiles + tables, no
  charts. Adding a chart library buys polish but not insight in a
  prototype.
