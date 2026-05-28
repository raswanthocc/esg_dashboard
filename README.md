# Breathe ESG — Ingestion Prototype

Django REST + React app that ingests emissions data from three source
types (SAP fuel, utility electricity, corporate travel), normalizes it,
and surfaces a review dashboard where an analyst can approve rows for
audit sign-off.

**Companion docs (read in this order):**
- [MODEL.md](MODEL.md) — data model design and why
- [DECISIONS.md](DECISIONS.md) — every ambiguity I resolved
- [TRADEOFFS.md](TRADEOFFS.md) — three things I deliberately did not build
- [SOURCES.md](SOURCES.md) — per-source research and what would break in prod

## Run locally

Requirements: Python 3.12+, Node 20+.

```bash
# Backend
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py seed
python manage.py runserver 8000

# Frontend (in a second terminal)
cd frontend
npm install
npm run dev
# Open http://localhost:5173 — Vite proxies /api to the Django server.
```

The seed command creates a demo tenant (`Acme Industries`, slug `acme`),
plant-code and airport lookup tables, and a small set of emission factors.

## Try it end-to-end (90 seconds)

1. Open the app. The tenant dropdown shows "Acme Industries"; the
   analyst input is blank — type any email so audit events get an actor.
2. Click **Upload**, drop in any of the three files from `sample_data/`.
   Each file upload triggers parse → normalize → flag → save and
   redirects you to the batch detail page.
3. Look at the batch detail page: total rows, normalized vs. flagged
   vs. failed, parser notes (encoding, separator, header map), the
   normalized records table, and a separate section for parse failures.
4. Click any record ID to see the canonical normalized fields, the
   original source row (immutable, JSON), the audit trail, and edit /
   approve / reject buttons.
5. Back on the batch detail or the global Review page, click
   **Bulk-approve clean rows** to sign off everything that didn't get
   flagged.
6. Visit the **Dashboard** to see totals by scope, by source, plus the
   pending / flagged / approved counters.

## Deploy to Render

The repo is a Render Blueprint (`render.yaml`). After connecting the
repo on Render:

1. Click **Apply Blueprint**. Render provisions Postgres + the web
   service, runs `build.sh` (installs Python deps, builds the React
   bundle, runs migrations, collects static).
2. Once deployed, open a Render Shell and run `python manage.py seed`
   to populate the demo tenant. (Not auto-run in build, so re-deploys
   don't mutate production data.)
3. The live URL serves both the API (under `/api/`) and the SPA shell.
   `X-Tenant: acme` is the only header you need.

## Project layout

```
backend/                Django project root
  breathe_esg/          settings, urls, wsgi
  core/                 tenant model + tenant middleware
  ingestion/            sources, batches, raw records, parsers, pipeline,
                        validators, seed command
  emissions/            ActivityRecord, EmissionFactor, lookup tables,
                        AuditEvent
  api/                  DRF serializers, views, routes
  templates/            index.html SPA shell
frontend/               React + Vite SPA (analyst UI)
sample_data/            CSVs for each of the three sources
render.yaml             Blueprint for one-click Render deploy
build.sh                Build script Render runs
MODEL.md / DECISIONS.md / TRADEOFFS.md / SOURCES.md
```

## How to add a new source

A working sketch:

1. Add a new value to `SourceType` in `ingestion/models.py`.
2. Write a parser at `ingestion/parsers/<name>.py` whose `parse(bytes)`
   returns a `ParseResult` of `ParsedRow` instances (see
   `parsers/base.py`). Parsers don't touch the DB; they're pure.
3. Register it in `ingestion/parsers/__init__.py:PARSERS`.
4. Seed any factors / lookup tables the new source needs in
   `seed.py`.
5. The pipeline, audit trail, validation, and UI all just work — they
   key off the canonical fields the parser produces.

## What the system intentionally doesn't do

See TRADEOFFS.md. Short version: no API connectors, no PDF parsing, no
auth / tenant admin / factor management UI. The prototype is focused on
the data model, the normalization pipeline, and the review experience.
