"""Corporate travel parser — Concur/Navan-style itinerary export.

What real travel platform exports look like:
    - One row per trip segment, not one row per trip
    - Type column: Flight / Hotel / Ground / Rail / Car Rental
    - Flights: origin + destination as IATA codes; distance is usually NOT
      included (you compute it from airport coords). Cabin class drives the
      emission factor (economy ≠ business).
    - Hotels: city + nights, sometimes hotel chain. No distance.
    - Ground: category + distance (sometimes) + amount. If distance is
      missing, you fall back to amount / typical fare-per-km — out of scope
      here, we flag instead.

What we handle: a single Concur-shape CSV with these columns. Distances are
computed for flights from IATA → coords lookup using great-circle (haversine);
hotels normalize to room-nights; taxis use distance if given else flag.

What we ignore: multi-leg fare class aggregation, currency conversion,
real-time API sync. See SOURCES.md.
"""

from __future__ import annotations

import csv
import io
import math
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional

from emissions.models import AirportCodeMap

from .base import Canonical, ParsedRow, ParseResult, finding

REQUIRED = {
    "trip_id": ["trip id", "trip", "itinerary id"],
    "traveller": ["traveller", "employee", "passenger", "traveler"],
    "type": ["type", "segment type", "category"],
    "date": ["date", "departure date", "check-in date", "start date"],
}

OPTIONAL = {
    "origin": ["origin", "from", "from airport"],
    "destination": ["destination", "to", "to airport"],
    "cabin_class": ["cabin", "class", "fare class"],
    "nights": ["nights", "room nights"],
    "distance_km": ["distance km", "distance", "km"],
    "city": ["city", "destination city"],
    "country": ["country"],
    "end_date": ["end date", "check-out date", "return date"],
}


def _normalize(s: str) -> str:
    return "".join(c.lower() for c in s if c.isalnum() or c == "_")


def _map_columns(headers: list[str], spec: dict[str, list[str]]) -> dict[str, int]:
    norm_to_idx = {_normalize(h): i for i, h in enumerate(headers)}
    out = {}
    for key, aliases in spec.items():
        for alias in aliases:
            n = _normalize(alias)
            if n in norm_to_idx:
                out[key] = norm_to_idx[n]
                break
    return out


def _parse_date(s: str):
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _parse_decimal(s: str) -> Optional[Decimal]:
    if not s or not s.strip():
        return None
    try:
        return Decimal(s.strip())
    except InvalidOperation:
        return None


def _haversine_km(lat1, lon1, lat2, lon2) -> Decimal:
    """Great-circle distance. Inputs are floats or Decimals in degrees."""
    r = 6371.0  # Earth radius km
    lat1, lon1, lat2, lon2 = map(float, (lat1, lon1, lat2, lon2))
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return Decimal(str(r * c)).quantize(Decimal("0.01"))


def _classify_flight(distance_km: Decimal) -> str:
    """DEFRA conventional bands. Boundaries are debated — we document our
    choice in SOURCES.md and let the analyst re-categorize if needed."""
    d = float(distance_km)
    if d < 1500:
        return "flight_short"
    if d < 3700:
        return "flight_medium"
    return "flight_long"


# Cabin class multipliers on top of the base flight factor. Source: DEFRA
# 2024 conversion factors guidance (rough numbers; documented in SOURCES.md).
# We don't store these in the DB as separate factor rows because they're
# multipliers, not absolute factors — keeping them inline avoids a join.
CABIN_MULTIPLIERS = {
    "ECONOMY": Decimal("1.00"),
    "PREMIUM": Decimal("1.60"),
    "PREMIUM ECONOMY": Decimal("1.60"),
    "BUSINESS": Decimal("2.90"),
    "FIRST": Decimal("4.00"),
}


def _airport_lookup_cache():
    return {a.iata_code.upper(): a for a in AirportCodeMap.objects.all()}


def parse(file_bytes: bytes) -> ParseResult:
    text = file_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))

    try:
        headers = next(reader)
    except StopIteration:
        return ParseResult(rows=[], parser_notes={"error": "empty file"})

    req = _map_columns(headers, REQUIRED)
    opt = _map_columns(headers, OPTIONAL)
    missing = [k for k in REQUIRED if k not in req]
    notes = {
        "headers_seen": headers,
        "required_columns": req,
        "optional_columns": opt,
        "missing_required": missing,
    }
    if missing:
        return ParseResult(rows=[], parser_notes=notes)

    airports = _airport_lookup_cache()
    out: list[ParsedRow] = []

    for idx, row in enumerate(reader, start=1):
        if not any((c or "").strip() for c in row):
            continue

        def col(key: str, source: dict) -> str:
            i = source.get(key)
            if i is None or i >= len(row):
                return ""
            return row[i].strip()

        raw = {h: (row[i] if i < len(row) else "") for i, h in enumerate(headers)}
        parsed = ParsedRow(index=idx, raw_payload=raw)

        seg_type = col("type", req).lower()
        start = _parse_date(col("date", req))
        if not start:
            parsed.error = "Unparseable start date"
            out.append(parsed)
            continue

        findings: list[dict] = []

        if seg_type in ("flight", "air"):
            o = col("origin", opt).upper()
            d = col("destination", opt).upper()
            cabin = col("cabin_class", opt).upper() or "ECONOMY"
            given_distance = _parse_decimal(col("distance_km", opt))

            if given_distance is not None and given_distance > 0:
                distance = given_distance
                distance_source = "source-provided"
            elif o in airports and d in airports:
                a, b = airports[o], airports[d]
                distance = _haversine_km(a.latitude, a.longitude, b.latitude, b.longitude)
                distance_source = "computed-haversine"
            else:
                unknown = [c for c in (o, d) if c not in airports]
                parsed.error = (
                    f"Cannot compute flight distance: unknown IATA code(s) {unknown}"
                )
                out.append(parsed)
                continue

            activity = _classify_flight(distance)
            cabin_mult = CABIN_MULTIPLIERS.get(cabin)
            if cabin_mult is None:
                findings.append(finding(
                    rule_id="cabin_class_unknown",
                    severity="warning",
                    message=f"Unknown cabin class {cabin!r} — defaulted to economy multiplier",
                    field="activity_type",
                    observed=cabin,
                ))
                cabin_mult = Decimal("1.00")

            # The cabin multiplier rides through as a parser hint; the
            # pipeline stores it on ActivityRecord.compute_multiplier so
            # the analyst can see the full CO2e arithmetic on the record
            # detail page (kWh × factor × multiplier = co2e).
            parsed.canonical = Canonical(
                scope="scope_3",
                activity_type=activity,
                period_start=start,
                period_end=start,
                original_value=distance,
                original_unit=f"km ({distance_source})",
                normalized_value=distance,
                normalized_unit="pkm",
                country=airports.get(d).country if d in airports else "",
                description=f"{o}→{d} {cabin}",
                parser_findings=findings,
                parser_hints={"compute_multiplier": str(cabin_mult), "cabin_class": cabin},
            )
            out.append(parsed)
            continue

        if seg_type == "hotel":
            nights = _parse_decimal(col("nights", opt))
            end = _parse_date(col("end_date", opt))
            if nights is None and end:
                nights = Decimal((end - start).days)
            if nights is None or nights <= 0:
                parsed.error = "Hotel row missing nights and end date"
                out.append(parsed)
                continue
            end = end or (start + timedelta(days=int(nights)))
            city = col("city", opt)
            country = col("country", opt).upper()
            if not country:
                findings.append(finding(
                    rule_id="hotel_country_missing",
                    severity="warning",
                    message="Hotel row has no country — will fall back to global average factor",
                    field="country",
                ))

            parsed.canonical = Canonical(
                scope="scope_3",
                activity_type="hotel_night",
                period_start=start,
                period_end=end,
                original_value=nights,
                original_unit="nights",
                normalized_value=nights,
                normalized_unit="night",
                site_name=city,
                country=country,
                description=f"Hotel {city}",
                parser_findings=findings,
            )
            out.append(parsed)
            continue

        if seg_type in ("ground", "taxi", "car", "rideshare"):
            distance = _parse_decimal(col("distance_km", opt))
            if distance is None or distance <= 0:
                parsed.error = (
                    "Ground transport row missing distance — fare-based fallback "
                    "is not implemented in the prototype"
                )
                out.append(parsed)
                continue
            parsed.canonical = Canonical(
                scope="scope_3",
                activity_type="taxi",
                period_start=start,
                period_end=start,
                original_value=distance,
                original_unit="km",
                normalized_value=distance,
                normalized_unit="pkm",
                country=col("country", opt).upper(),
                description=f"Ground {col('city', opt)}".strip(),
                parser_findings=findings,
            )
            out.append(parsed)
            continue

        if seg_type == "rail":
            distance = _parse_decimal(col("distance_km", opt))
            if distance is None or distance <= 0:
                parsed.error = "Rail row missing distance"
                out.append(parsed)
                continue
            parsed.canonical = Canonical(
                scope="scope_3",
                activity_type="rail",
                period_start=start,
                period_end=start,
                original_value=distance,
                original_unit="km",
                normalized_value=distance,
                normalized_unit="pkm",
                country=col("country", opt).upper(),
                description=f"Rail {col('city', opt)}".strip(),
                parser_findings=findings,
            )
            out.append(parsed)
            continue

        parsed.error = f"Unknown segment type {seg_type!r}"
        out.append(parsed)

    return ParseResult(rows=out, parser_notes=notes)
