# Decisions

Every non-obvious choice I made, why I made it, and what I'd ask the PM if
I could. Organized by the thing the decision touches.

## Ingestion mechanism: file upload for all three sources

**What I chose.** A single uniform file-upload pipeline. Each source has its
own parser; the orchestrator is shared.

**Why.** Three parts.

1. *Realism, not toy.* A sustainability vendor onboarding a new enterprise
   client gets files emailed to them in week one. APIs come later, after
   the client provisions OAuth credentials, SAP RFC access, and a Concur
   tech contact. Modeling that reality means file upload is the realistic
   onboarding path, not a shortcut.
2. *Honest scope for 1 day.* Building a Concur OAuth flow, an SAP OData
   client, and a utility API poller each cost a day of plumbing for zero
   data-model insight. Choosing one mechanism keeps the budget on the
   parts that show judgment (data model, normalization, review UX).
3. *One pipeline is testable.* A single ingestion code path means flag
   rules, audit emission, and tenant scoping all happen in one place
   instead of three near-duplicate adapters.

**What I'd ask the PM.** Which of the three sources is most likely to be
real-time / event-driven in production? That's where the next investment
goes — pre-building an API pull for the wrong one is wasted work.

## SAP format: flat-file SE16/SQVI export

**What I chose.** Parse a semicolon-delimited flat file with German *or*
English headers, decimal-comma support, DD.MM.YYYY dates, and SAP MEINS
unit codes. Subset: fuel material movements only.

**Why.** IDoc is XML EDI overkill for a one-way data handoff; nobody hands
you raw IDocs without a middleware in between. BAPI/OData need the client
to provision a service user and authorize each function module during
onboarding — that's a 2-week procurement step, not week one. Flat-file
dumps out of SE16 / SQVI / MB51 are what clients actually send when the
question is "can you just send me the fuel movements as a spreadsheet?"

**What I deliberately ignored.** Currency conversion, GL postings, anything
material that isn't fuel-relevant, custom material text in non-Latin
scripts. See TRADEOFFS.md.

**What I'd ask the PM.** Do clients have a designated SAP material group
or material number range that marks "fuel," or do we always rely on
description matching? My keyword approach is fragile; a material-group
filter would be much more reliable.

## Utility: portal CSV

**What I chose.** Portal CSV export shaped like Tata Power / BSES exports.
One row per meter per billing period.

**Why.** PDF parsing is a real time sink with brittle output. Green Button
(the US standard for energy usage XML/CSV) is US-only and not universally
exposed by retail utilities. Most facilities teams pull a CSV from a portal
and email it monthly.

**What I deliberately ignored.** PDF bills, Green Button, demand charges
(kW vs kWh distinction), time-of-use rate breakdowns, tariff parsing,
solar PV self-consumption nuance.

**What I'd ask the PM.** What's our policy on negative consumption rows
(solar export)? Right now I flag them. Do we count them as a Scope 2
*reduction*, treat them as a separate Scope 2-avoidance metric, or ignore
them entirely?

## Travel: Concur-style itinerary CSV

**What I chose.** One CSV with rows per segment, types `Flight | Hotel |
Ground | Rail`. Flights specify IATA codes; I compute distance via
great-circle from a seeded airport table. Cabin class drives a multiplier
on the flight emission factor.

**Why.** Real Concur exports give you segments not trips, IATA codes not
distances, and cabin class as a string column. Hotels give nights + city
but rarely coordinates. Ground transport sometimes has distance, sometimes
only an amount. I handle the distance-given path; I deliberately don't
build the fare-amount fallback for ground.

**What I deliberately ignored.** Real Concur/Navan OAuth + API sync,
currency conversion, multi-leg fare-class aggregation, car-rental category
breakdown (compact vs SUV).

**What I'd ask the PM.** What do we do when distance is missing for ground
transport? Three options I see: flag and stop, infer distance from fare
amount + city-typical fare-per-km, or just count it as a fixed-per-ride
factor. Each has accuracy/audit-defensibility tradeoffs.

## Distinguishing "failed" from "flagged"

**What I chose.** Two distinct concepts:
- *failed* = couldn't parse at all. No ActivityRecord; lives on RawRecord
  with `parse_error`. Surfaced in a dedicated "Failed rows" section of the
  batch detail page.
- *flagged* = parsed and normalized, but a validator raised concerns.
  Lives as an ActivityRecord with `status=flagged` and a list of human-
  readable `flag_reasons`. Surfaced in the review queue.

**Why.** The analyst can fix flagged rows in the UI (edit a unit, override
the activity type, approve anyway). They cannot fix failed rows from the
UI — those need the source-system owner to re-export. Conflating the two
hides this asymmetry.

**What I'd ask the PM.** Do we expose a "request re-export" workflow to
the analyst for failed rows (Slack the SAP admin, etc.)? Out of prototype
scope but the right next step.

## Validation rules: flag, don't fail

**What I chose.** Validators raise informational flags; they never drop
rows. Out-of-range values, missing factor, duplicate-period suspicion —
all become a `flag_reasons` entry, and the status moves to `flagged`.
Approval is the analyst's call.

**Why.** False positives are inevitable in flagging; making the system
delete rows on its own opinion would be worse than leaving them visible
and noted. The cost of a flag is one extra review step. The cost of a
silent drop is a missed emission.

## "Approval = lock"

**What I chose.** Once a record is approved, the API refuses edits. To
re-open you reject first, which creates a new audit event.

**Why.** "Approved" has to mean something for audit sign-off. If approved
records were silently editable, the audit trail wouldn't bind the analyst
to anything. Re-open-via-reject is a slightly heavier flow, but it forces
the audit event to be created explicitly.

## Bulk approve for clean rows, not for flagged

**What I chose.** Bulk-approve endpoint only approves `status=pending`
rows (the ones with no flags). Flagged rows have to be handled one at a
time.

**Why.** Analyst UX is one of the grading axes. A 400-row clean batch is
unusable if you have to click 400 times. But bulk-approving *flagged* rows
defeats the entire purpose of flagging. So: one big "approve clean rows"
button, and individual approve for everything else.

## Tenant scoping: `X-Tenant` header

**What I chose.** Tenant is selected via an `X-Tenant: <slug>` header,
read by middleware, applied as a queryset filter.

**Why.** No login system exists in the prototype, so subdomain-based
tenant resolution doesn't fit. A header is the simplest thing that
correctly models the production end-state (an auth token would resolve to
a tenant identically). The frontend stores the selected tenant slug in
localStorage and includes it on every request.

**Tradeoff.** In production you'd want this server-resolved from the
authenticated session, not client-controlled. The current setup is fine
for a prototype but is *not* a security model.

## Analyst identity: optional `X-Analyst` header

**What I chose.** A free-text `X-Analyst: email@…` header that auto-
creates an `AnalystUser` row on first sight, used purely for audit
attribution. Missing header → events recorded as actor "system."

**Why.** I don't want to build auth, and I don't want audit events to
have no actor. This is the smallest thing that gives non-anonymous audit
attribution without any auth code.

## Frontend asset hashing disabled

**What I chose.** Vite config emits `assets/index.js` and `assets/index.css`
with no hash. Django serves them via Whitenoise.

**Why.** Django's index.html template needs to reference asset URLs
statically. Without a Vite manifest reader (django-vite, etc.), hashed
filenames break the template. Disabling hashing is the simplest fix for
a prototype; in production you'd wire up django-vite.

**Tradeoff.** Cache busting is weaker — clients with stale JS will pick
up changes after their browser cache expires rather than instantly. For a
prototype, fine.

## Emission factor fallback: country+year → country+any → GLOBAL

**What I chose.** When looking up a factor, prefer exact (country, year);
fall back to country with any year (latest); fall back to GLOBAL with any
year. If still nothing, leave CO2e null and flag the record.

**Why.** Predictable degradation. A row will never be silently lost — it
becomes a flagged row with "no factor matched" rather than disappearing.
And the fallback hierarchy mirrors how a sustainability analyst would
reason: "Use the country factor for the year if you have it; otherwise the
country's latest; otherwise the global average; otherwise tell me."

**What I'd ask the PM.** Should `default_country` on the tenant influence
this — i.e., should rows with no country fall back to the tenant default
before going GLOBAL? Right now I do exactly that in the pipeline (it sets
`country = organization.default_country` when blank), but it's worth a
conversation with the methodology lead.

## CO2e computation lives in the pipeline, not as a model method

**What I chose.** `ActivityRecord.co2e_kg` is a stored column, written
once at ingest by the pipeline.

**Why.** Computed-on-read would mean joining the factor table on every
query and recomputing for every dashboard render. Storing it makes
totals queryable with a sum, makes the audit history meaningful (you can
see *what* CO2e value was approved), and lets us track factor-version
drift over time. The cost is having to write a re-derive script when
factors change — which we'd want anyway, since changing factors should
write new audit events, not silently mutate approved numbers.

## Database: SQLite local, Postgres in prod

**What I chose.** `dj-database-url` reads `DATABASE_URL`. Locally that's
SQLite (no setup); on Render it's the provisioned Postgres.

**Why.** Zero local-setup friction matters for the reviewer running the
project. Postgres in prod because of JSONField behavior, concurrency, and
because Render gives you one for free.

## Tests: skipped intentionally

**What I chose.** No unit tests in this submission.

**Why.** I'd rather submit fewer, sharper things than spread the budget
thin. The parsers, normalizer, and validators are the right targets for
unit tests in a second pass — they're pure functions with explicit
contracts. I made the parsers DB-independent (`Canonical` dataclass) so
they'd be testable in isolation when that pass happens.

**What I'd ask the PM.** What's your testing bar for ingestion code in
real production? I'd want to know before deciding between unit tests of
parsers, golden-file regression tests against frozen sample exports, or
property-based tests on the normalizer.
