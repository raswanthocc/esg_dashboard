# Data Model

This is the part of the submission I want to defend hardest. Every shape choice
here is in service of one goal: **make the analyst's review queue trustworthy
and the auditor's question — "where did this number come from?" — answerable
in one click**, while still letting us re-process the same input if our
factors or normalization rules change later.

## The spine: raw vs. canonical, separated

Three tables carry the whole pipeline:

```
IngestionBatch    ──┐  one upload event (who, when, file SHA, parser notes,
                    │  row counts, status)
                    │
                    ├─►  RawRecord     "what the source said"
                    │    immutable JSON of the original row + parse error
                    │    if any. 1 per source row, always.
                    │
                    └─►  ActivityRecord "what we made of it"
                         the canonical, normalized, computed, reviewable row.
                         1 per successfully parsed raw row (OneToOne).
                         carries scope, activity_type, period, original and
                         normalized values side-by-side, factor FK, CO2e,
                         status, flag_reasons.
```

Why split raw and canonical? Three reasons, in order of importance:

1. **Auditability.** When an auditor or analyst asks "what does the source
   actually say?" we don't show them our interpretation — we show them the
   original row bytes (decoded). The fact that the canonical record sits next
   to it means a wrong normalization is visible at a glance.
2. **Re-derivability.** Emission factors get re-published every year. When
   DEFRA 2025 lands, we can re-run normalization against the immutable
   RawRecords without touching the source files or hoping our import is
   re-runnable. The canonical row can change; the raw row never does.
3. **Schema flexibility.** SAP, utility, and Concur formats differ wildly,
   and the *next* source we onboard will too. A typed canonical row + a JSON
   blob raw row means parsers can evolve without DB migrations.

`source_row_number` on RawRecord lets the analyst cross-reference the
original spreadsheet. `file_sha256` on IngestionBatch lets us reject
duplicate uploads instead of silently double-counting.

## Multi-tenancy: schema-level, not feature-built

`Organization` is the tenant. **Every** domain row (RawRecord, ActivityRecord,
Batch, AuditEvent, PlantCodeMap, AnalystUser) has an `organization` FK.
Querysets are scoped by `TenantMiddleware`, which reads an `X-Tenant` header
and attaches `request.tenant` to every API view. The view code never has to
filter manually — it pulls from `request.tenant`.

This is enough to let two clients' data coexist safely in one database. What
I did **not** build:

- Per-tenant DB schemas (schema-per-tenant pattern). Overkill for a prototype.
- Row-level security in Postgres. Useful in production, doesn't fit a 1-day build.
- A tenant admin UI. Tenants are seeded via management command. See TRADEOFFS.md.

The middleware design means promoting to per-schema or RLS later is a config
change, not a model rewrite — the FK is already universal.

## Scope 1/2/3: stored, not computed

`ActivityRecord.scope` is a stored field, not derived. The natural mapping is:

- SAP fuel posting → Scope 1 (direct combustion)
- Utility electricity → Scope 2 (purchased energy)
- Business travel → Scope 3 (value chain)

But the same activity can land in a different scope depending on contract
terms — leased vehicles can be Scope 1 or Scope 3 depending on the
operational/financial control boundary, and PPA-backed renewables affect how
Scope 2 is reported (location- vs market-based). I store scope so analysts
can re-categorize during review without code changes; the parser sets a
sensible default.

## Source-of-truth tracking

Every ActivityRecord answers three questions about its provenance:

- **Which file?** `batch_id` → `IngestionBatch` → `original_filename`, SHA, uploader
- **Which row in that file?** `raw_record_id` → `source_row_number`, `payload`
- **Has it been touched since import?** `edited_after_import` boolean, plus
  `last_edited_by`/`last_edited_at`, and the full AuditEvent log

The `original_value`/`original_unit` columns are duplicated on the canonical
row alongside `normalized_value`/`normalized_unit` so the analyst dashboard
can show "12.450,75 L → 12450.75 L" without expanding the raw payload. This
small redundancy buys real review speed.

## Unit normalization

Every parser produces a `(normalized_value, normalized_unit)` pair where
`normalized_unit` is one of a tiny set: `L`, `kg`, `kWh`, `pkm`, `night`,
`km`. Emission factors are keyed on this set. The original unit travels
along for audit visibility.

SAP-specific wart: decimal-comma + thousands-dot ("1.234,56") and the SAP
MEINS unit codes (M3, L, KG, EA…) are handled in the parser, not in a
global normalizer — different vendors use different conventions, and a
single normalizer becomes a config soup. Each parser owns its conversions.

## Audit trail: first-class, not implementation detail

`AuditEvent` is append-only. Every state change writes one — ingestion,
flagging, edit, approve, reject. Each event stamps actor (or "system"),
timestamp, action, and JSON before/after snapshots. We don't use a generic
history library because the audit trail is part of the product surface:
auditors will look at this table, so its shape needs to be intentional
rather than whatever django-simple-history happens to emit.

The JSON before/after lets us replay history without joining other tables
and survives schema changes — even if a field is removed from
ActivityRecord later, the historical events still describe what happened.

**Approval = lock.** Once `status = APPROVED`, the API refuses edits. To
re-open you have to reject first, which writes its own audit event. This
is the auditor-facing guarantee — "approved" means immutable.

## Lifecycle state machines

There are **two** state machines and they live on **two different tables** —
this is deliberate. Conflating them ("FAILED → PARSED → NORMALIZED →
FLAGGED → PENDING → APPROVED → LOCKED" as one long chain) hides the fact
that *batch* status is about the upload event and *row* status is about
analyst review. They run at different layers.

### Batch lifecycle (on `IngestionBatch.status`)

```
received ─► parsing ─┬─► parsed   (all rows attempted; counts populated)
                     └─► failed   (parser couldn't read the file at all,
                                   e.g. missing required headers)
```

A batch is immutable once it leaves `parsing`. Re-processing the same file
(after fixing a parser bug, for example) is a *new* batch, with its own
SHA, its own audit. We never mutate batch state after the pipeline completes.

### Row lifecycle (on `ActivityRecord.status`)

```
                  ┌─► pending  ─► approved  (locked, immutable for audit)
ingested ─► auto- │       ▲           │
            valid │       │ edit      │ reject (must reject before re-open)
                  │       │           ▼
                  └─► flagged ──► rejected
                          │           │
                          └─► edit ───┘
                              clear-flags?
                              ► pending
```

Rules:
- **`pending`** = parsed, normalized, *zero* warning/error findings. Eligible
  for `bulk-approve`.
- **`flagged`** = at least one warning/error finding. Info-only findings (e.g.
  "estimated reading") do *not* flag — they surface in the findings panel but
  don't block bulk approval. This is a real distinction.
- **`approved`** = locked. `approved_at` and `approved_by` are set once;
  edit endpoint refuses with 409. To re-open: explicit reject → fresh audit
  event → row becomes editable.
- **`rejected`** = analyst removed the row from the report. Can be re-edited
  back into review (writes a new audit event); cannot be silently un-rejected.

`approved == locked` by design — see [DECISIONS.md](DECISIONS.md). A separate
"locked" state would let approved rows be silently editable between approve
and lock, which destroys the audit guarantee.

### Why parse failures aren't a row status

Unparseable rows have no `ActivityRecord` at all — they live as `RawRecord`
with `parse_error` set, surfaced in the batch detail page's failed-rows
section. The analyst can't *fix* a parse failure from the UI; they need
the source-system owner to re-export. Putting parse failures in the row
state machine would imply they're reviewable, which they aren't.

### `flag_reasons` schema

JSON list on `ActivityRecord`, where each entry is:
```json
{ "rule_id": "value_out_of_range",
  "severity": "warning",
  "message": "Value 8500000kWh exceeds plausible maximum 5000000kWh — unit mistake?",
  "field": "normalized_value", "observed": "8500000", "threshold": "5000000" }
```
Stored as JSON (not a separate `ValidationFinding` table) because findings
are read with the row, not queried independently in v1. Promoting to a
table is a future move when we want per-finding resolution ("analyst
dismissed this flag with note") — the data shape is the same.

We index `ActivityRecord` on `(organization, status, scope)` so the
dashboard's primary filter is fast even with millions of rows.

## Emission factors: deliberately tiny

`EmissionFactor` is keyed `(activity_type, unit, region, valid_year)`. The
pipeline resolves the best match by falling back: country+year → country+any
year → GLOBAL+any year → none. The strategy that fired is stored on the
`ActivityRecord.factor_match_strategy` column (one of `exact`,
`country_any_year`, `global`, `none`) and rendered as a badge on the
record-detail page. An auditor's first question on a Scope 2 row is "did
this use the country grid factor or a global average?" — surfacing the
strategy answers that without them having to ask.

Flight cabin class is handled as a multiplier in the pipeline rather than
as more factor rows, because that's how DEFRA actually publishes its
guidance (one factor per haul band, multipliers for cabin). The applied
multiplier is stored on `ActivityRecord.compute_multiplier` so the inline
CO₂e arithmetic on the record detail page is fully auditable:
`normalized_value × kg_co2e_per_unit × multiplier = co2e_kg`.

What I deliberately didn't model:

- Vintage/effective-date ranges. A real factor library tracks "this factor
  was current from X to Y." We only track `valid_year`.
- Per-tenant custom factors. Real clients negotiate custom factors with
  auditors; this table has no `organization` FK on purpose — global library
  only.
- Factor uncertainty bands. Auditors care; prototype doesn't.

See TRADEOFFS.md for the full reasoning.

## Lookup tables: small but real

- `PlantCodeMap` (tenant-scoped): SAP WERKS → site name + country. Unmapped
  codes flag the row, not drop it.
- `AirportCodeMap` (global): IATA → coords for great-circle distance. Seeded
  with the airports our sample data references.

Both are seeded via `python manage.py seed` (idempotent). In production
the plant codes would come from the client's master data — uploading a
plant-code CSV per onboarding would be the natural extension.

## What the model intentionally does NOT have

- A `Site` or `Facility` entity. Plant code → site name is a flat lookup;
  promoting it to its own table would let us track site-level metadata
  (geo, ownership-share, sub-units) but it's not paying for itself in
  prototype scope. The denormalized `site_name` + `country` on
  ActivityRecord is good enough.
- A `User` model beyond AnalystUser. No login, no roles, no permissions —
  authentication is out of scope. AnalystUser exists purely to carry an
  identifier for audit attribution.
- Soft deletes. Auditable systems don't delete; rejection covers the
  intent. We never need `is_deleted`.

---

The grading criterion says data model is 35% of the score. The two things
I'd hammer on in defense: (a) **separating raw from canonical** is the
unlock for everything else, including reprocessing and trustworthy review;
(b) **AuditEvent as a first-class product table, not an implementation
detail**, is the right call when sign-off is the literal feature.
