# Sources

For each of the three source types: what real-world format I researched,
what I learned, what my sample data looks like and why, and what would
break in a real deployment.

---

## 1. SAP — Fuel & Procurement

### What I researched

SAP exposes material movement data through several mechanisms:

- **IDoc** (Intermediate Document, SAP's EDI format) — XML, schema per
  message type (e.g., `MATMAS`, `WMMBID`). Used for system-to-system
  messaging via SAP PI / PO / IS / cloud integration suite. Heavy.
- **BAPI/RFC** — function-module callable interfaces over RFC. Needs SAP
  RFC SDK / pyrfc, plus a service user with SAP_ALL or carefully scoped
  authorizations. The "right" way for streaming integrations.
- **OData (Gateway)** — SAP Gateway exposes BAPIs as RESTful OData. Modern
  but still needs Gateway configured by the client's Basis team.
- **Flat-file export from SE16 / SQVI / MB51** — what most clients
  actually email when you ask for "the fuel movements." `MSEG` or `MKPF`
  tables exported to a semicolon-delimited file in the German SAP locale,
  optionally with header translation if the GUI is in English.

### What I learned (the warts)

- **Encoding.** SAP GUI on Windows defaults to cp1252 / latin-1, not UTF-8.
  Material descriptions in German contain umlauts ("Erdgas", not
  "Erdgas") that break naive `.decode('utf-8')`. My parser tries
  utf-8-sig → utf-8 → cp1252 → latin-1.
- **Decimal comma.** "1.234,56" is one thousand two hundred thirty-four
  point five six. My `_parse_german_decimal` handles both `1.234,56` and
  `1234.56`. Single comma is decimal (in German locale exports it's
  virtually never a thousands separator).
- **Dates.** DD.MM.YYYY (German), sometimes YYYY-MM-DD (English locale),
  occasionally YYYYMMDD if the export came from an ABAP report. My
  parser tries all three.
- **Plant codes (WERKS).** Four-character codes like `IN01`, `DE07`,
  `US12`. Meaningless without `PlantCodeMap`. I flag unmapped codes
  rather than dropping the row.
- **Material numbers (MATNR).** Left-padded with zeros to 18 chars:
  `000000000001000201`. I strip the padding for display.
- **Activity inference is fuzzy.** Out of the box, SAP doesn't tag
  materials with "this is fuel for emissions reporting." Material
  groups (MATKL) help but are configured per client. My parser uses
  keyword matching on the description (`diesel`, `HSD`, `petrol`, `MS `,
  `natural gas`, `PNG`, `CNG`, `LPG`). Unmatched → activity `other`,
  which surfaces as a flag.
- **Unit of measure (MEINS).** SAP supports hundreds of UoMs. I handle
  L / LTR / ML / M3 / KG / G / T / EA. Anything else (`FU` in the sample,
  meaning who-knows-what) is a parse error.

### My sample data

`sample_data/sap_fuel_q1_2025.csv` — 20 rows of fuel & procurement
movements across Q1 2025 for three plants (IN01, IN02, DE07, US12). Wart
inventory:

- German headers (`Materialnummer`, `Materialkurztext`, `Werk`, `Menge`,
  `Mengeneinheit`, `Buchungsdatum`, `Bewegungsart`).
- Semicolon-separated.
- Decimal-comma numbers ("12.450,75").
- DD.MM.YYYY dates.
- Left-padded 18-char material numbers.
- One unknown plant code (`UNKNOWN`) → flag.
- One unknown unit (`FU`) → parse error → "failed" row visible in batch detail.
- One non-fuel material (Office Stationery, MATNR ending in `...900`) →
  parses but activity inferred as `other` → flag.
- M3 entries for natural gas, KG entries for LPG — different units
  exercising the normalizer.
- Atlantic plant (`US12`) and German plant (`DE07`) on top of the two
  Indian plants — exercises country-specific factor lookup.

### What would break in a real deployment

- **Non-Latin material descriptions.** A Japanese or Korean SAP install
  will have material text my keyword matcher doesn't recognize. Activity
  inference would degrade to `other` for everything.
- **Material groups not used.** Some clients structure their fuel
  procurement under a single MATKL ("FUEL_DIRECT") that we should be
  filtering on instead of keyword-matching the description. We don't
  read MATKL at all in the prototype.
- **Multi-currency, multi-company-code reports.** SAP exports often
  include CURRENCY and BUKRS (company code) columns. I ignore them. A
  multi-tenant client with several legal entities would need company-code
  → tenant routing.
- **Document types.** `MSEG` includes returns, transfers, reservations,
  and consumption postings all in one table. I treat every row as a
  consumption. A real implementation filters on `BWART` (movement type)
  — 261/262 for consumption against cost center, 201 for goods issue, etc.

---

## 2. Utility — Electricity

### What I researched

How facilities teams actually get electricity data:

- **Portal CSV download.** Tata Power, BSES, Adani, JSEB and most
  US/EU retail utilities offer a "download usage as CSV" button in their
  customer portal. Format varies wildly between utilities but the
  shape — one row per meter per billing period — is consistent.
- **PDF bills.** Universal, painful. Layout differs per utility, often
  per region within a utility, and scanned bills need OCR.
- **Green Button** — US standard for energy usage XML (and CSV-flavored
  variants), endorsed by DOE. Not all retail utilities expose it; not
  available outside the US. Worth knowing about; not worth depending on.
- **AMI / smart-meter APIs.** Some industrial customers have direct
  meter telemetry via SCADA or a building management system. Vendor-
  specific; out of scope for vendor-agnostic ingestion.

### What I learned (the warts)

- **Billing periods don't align with calendar months.** Bills run
  meter-read-to-meter-read, so periods like 16-Dec to 15-Jan are
  standard. Reporting on calendar months requires splitting consumption
  proportionally — I store the actual period and leave the calendar-
  month bucketing to the analyst (the dashboard could chart it
  post-hoc; not built).
- **Units.** Residential meters use kWh; large industrial meters use
  MWh, sometimes GWh on cumulative bills. Parser supports kWh/MWh/GWh/Wh.
- **Negative consumption.** Solar PV with net-metering and grid export
  contracts produce *negative* rows on the export-meter side. Real
  utilities show these as "net export" or as a separate meter. I flag
  negatives but don't drop them — the analyst decides whether they're
  Scope 2 reductions or out-of-scope.
- **Estimated vs actual reads.** Bills marked "estimated" (the meter
  reader didn't visit) carry a "Read Type" column. I flag them so the
  analyst can decide whether to accept the estimate.
- **Multiple meters per site.** Industrial sites have a main supply
  meter, plus sub-metered EV chargers, solar export, perhaps a backup
  generator. They're all under one site name but distinct meter IDs.
  My data model carries meter ID in the description and site name in
  `site_name` — both are visible in the review UI.

### My sample data

`sample_data/utility_electricity_q1_2025.csv` — 19 rows across four sites
spanning Q1 2025. Wart inventory:

- Three months × two main meters in Pune and Chennai (`PUNE-MAIN-001`,
  `CHN-MAIN-001`).
- Solar export meter at Pune (`PUNE-SOLAR-01`) with negative kWh → flags
  for "negative consumption."
- EV charging sub-meter at Chennai (`CHN-EV-001`) showing
  multi-metering at one site.
- Munich Plant data in MWh (`MUC-MAIN-001`) → unit normalization test.
- One estimated-reading row (`CHN-MAIN-001` Dec-Jan, "Yes" in Estimated)
  → flagged.
- One billing period spanning >60 days (`ATL-WAREHOUSE` Dec 20 → Feb 22)
  → flagged as "outside normal monthly range."
- One absurd consumption row (8,500,000 kWh) on `PUNE-AUX-002` to
  exercise the range-band flag (analyst sees: "exceeds plausible maximum
  — unit mistake?").
- Country column per row, exercising country-specific grid factors.

### What would break in a real deployment

- **PDF-only utilities.** As noted in TRADEOFFS.md, not handled.
- **Time-of-use billing.** Some utilities charge differently by hour-of-
  day; the raw consumption is split into TOU buckets in the bill. We
  treat consumption as a single number — the analyst loses TOU-aware
  emission factor lookups (some grids have time-varying carbon intensity).
- **Demand charges.** Industrial bills include `kW` (peak demand) on top
  of `kWh` (energy). I ignore demand entirely — it's not a Scope 2
  emission driver, but a real product might want to surface it for cost
  attribution.
- **Reactive power (kVAR/kVA).** Same as above. Out of scope.

---

## 3. Corporate Travel — Concur-style

### What I researched

- **Concur Travel & Expense.** Reports & data export via the Concur
  Report Builder (UI) or the v3 API. The API needs OAuth 2 plus an
  app-registration through the Concur dev portal — multi-week process.
  Report exports give you CSV / XML / JSON with one row per segment
  (booked flight, hotel night, car rental, ground transport).
- **Navan (formerly TripActions).** API-first, OAuth 2, JSON. Different
  field names from Concur but the same conceptual shape: segments under
  a trip ID, traveler email as the key.
- **Egencia, BCD, others.** Each ships its own export format. The
  common denominator is *segment-level rows* identified by trip ID +
  segment type.

### What I learned (the warts)

- **Distance is rarely given.** Flight segments almost always show
  origin + destination as IATA codes, not km. You have to compute the
  distance — great-circle (haversine) is the standard for "before
  takeoff routing" calculation. ICAO publishes guidance for this.
- **Cabin class drives the factor.** Economy ≠ business ≠ first ≠
  premium economy. DEFRA 2024 conversion factor guidance publishes
  cabin multipliers (roughly: premium economy ×1.6, business ×2.9,
  first ×4 relative to economy). I apply these inline at CO2e
  computation; I deliberately don't store them as separate factor rows.
- **Flight haul bands.** Short / medium / long haul boundaries vary by
  source. I use: <1500 km short, 1500–3700 km medium, ≥3700 km long
  (close to DEFRA's "short" / "domestic" / "long" / "international long
  haul" buckets). This is a judgment call.
- **Hotels.** Concur gives you check-in, check-out (or just nights),
  city, sometimes hotel chain. No coordinates. We compute by nights and
  use a country-specific per-room-night factor (Cornell Hotel
  Sustainability Benchmarking provides these).
- **Ground transport.** Wildly inconsistent. Sometimes distance, often
  just a fare amount with a category ("taxi", "Uber", "rideshare").
  Falling back to fare-to-distance estimation is its own product; I
  flag and skip.
- **Unknown airports.** Tomorrow someone books JNB ↔ CPT and my IATA
  lookup is empty. I treat this as a parse failure, not a flag, because
  there's nothing the analyst can do in-app to fix it — they have to
  add the airport to the lookup table (admin task).

### My sample data

`sample_data/travel_concur_q1_2025.csv` — 32 segment rows across 10
trips in Q1 2025. Wart inventory:

- All segments are linked by `Trip ID` to show the segment-level shape.
- Multiple traveler emails to exercise grouping.
- Four cabin classes: Economy, Premium Economy, Business, First —
  exercises the multiplier table including "Premium Economy" alias.
- All flight distances *missing* from the source — exercises the
  haversine computation from IATA lookup.
- Hotels with nights only (no end_date) and with both — both paths covered.
- Ground transport rows with distance (Delhi, NY) and one without (SFO)
  → exercises the "missing distance" failure path.
- A rail segment (Delhi, 250 km) — separate activity type.
- One unknown IATA code (`XXX`) → flight parse failure → "failed" row.
- One hotel with no country (`T-2025-0008` in Unknown) → "missing
  country, using global average" flag.
- Geographic spread (IN, SG, GB, AE, DE, US, HK) exercises the
  country-specific hotel factor fallback.

### What would break in a real deployment

- **API ingestion.** Not built; we'd need full OAuth flows per platform.
- **Currency / cost ingestion.** Travel costs are interesting to
  finance, not to emissions. We ignore them. If they're needed later,
  they're additional columns on the canonical row.
- **Cancellations and re-bookings.** Concur and Navan emit cancellation
  rows that can wipe out a previously-counted flight. We don't model
  this — a real implementation needs a "supersedes" relationship on
  travel segments.
- **Car rentals.** Treated as ground transport in the parser, but real
  car-rental rows have engine type / vehicle class that drive very
  different factors (an SUV-week is not a compact-week). Not modeled.
- **Hotel coordinates.** No lat/lon means we can't apply local grid
  factors to hotel-night electricity. The Cornell HSB country average is
  a coarse approximation.

---

## Cross-cutting: emission factor sourcing

The seed command (`backend/ingestion/management/commands/seed.py`) loads
a small set of factors. Sources, with caveats:

- **Fuel combustion** — DEFRA 2024 GHG conversion factors. The diesel /
  petrol / LPG numbers are reasonable global proxies; the natural gas
  number stored as `(activity=natural_gas, unit=L)` is a *placeholder*
  derived by converting m³ → L (gas-phase, not liquid-equivalent), which
  is dimensionally wrong but the right shape — a production version
  would handle gaseous natural gas in m³ as its own canonical unit with a
  proper factor (DEFRA ~1.886 kg CO2e/m³). I noted this in the seed
  comment and on the factor source string.
- **Electricity** — IN: India CEA v19 FY23-24 baseline. DE: EEA 2024.
  US: EPA eGRID 2024 national average. GB: BEIS 2024. GLOBAL fallback: IEA
  2024 world average. All published, all auditable; numbers rounded for
  the prototype.
- **Flights** — DEFRA 2024 per-pkm by haul band (economy baseline). Cabin
  multipliers from the same source applied inline by the pipeline.
- **Hotels** — Cornell Hotel Sustainability Benchmarking 2023 country
  averages.
- **Ground/rail** — DEFRA 2024 per-pkm averages.

The factor numbers in `seed.py` are illustrative. A production
implementation would source the factor library from a maintained
external service (Climatiq, ecoinvent, internal SME team) with versioning,
not hardcode them.
