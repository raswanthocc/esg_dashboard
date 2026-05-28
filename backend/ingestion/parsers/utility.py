"""Utility electricity portal CSV parser.

What real utility portal exports look like:
    - Comma-separated, UTF-8, English headers
    - Per-meter rows with billing period start/end (NOT calendar months)
    - Consumption in kWh, sometimes MWh for industrial meters
    - 'Estimated' flag when the meter wasn't physically read that period
    - Multiple meters per site (main + sub-metering for solar, EV charging)
    - Tariff column we mostly ignore for emissions (matters for cost, not CO2e)

What we handle: portal CSV in the shape Tata Power / BSES / similar Indian
utilities expose. The Green Button standard (US) uses XML; we noted that in
SOURCES.md and deliberately don't handle it.

What we ignore: PDF bills, tariff parsing, demand charges (kW vs kWh),
multi-rate time-of-use breakdowns. The prototype computes one CO2e per
billing-period row using a flat grid factor.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Optional

from .base import Canonical, ParsedRow, ParseResult, finding

REQUIRED_COLUMNS = {
    "meter_id": ["meter id", "meter", "mpan", "meter_number"],
    "site": ["site", "site name", "premises", "location"],
    "period_start": ["period start", "billing start", "from", "service period start"],
    "period_end": ["period end", "billing end", "to", "service period end"],
    "consumption": ["consumption", "usage", "kwh", "energy"],
    "unit": ["unit", "uom"],
}

OPTIONAL_COLUMNS = {
    "estimated": ["estimated", "read type", "is_estimated"],
    "country": ["country"],
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
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _parse_decimal(s: str) -> Optional[Decimal]:
    if not s:
        return None
    s = s.strip().replace(",", "")
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


UNIT_TO_KWH = {
    "KWH": Decimal("1"),
    "MWH": Decimal("1000"),
    "GWH": Decimal("1000000"),
    "WH": Decimal("0.001"),
}


def parse(file_bytes: bytes) -> ParseResult:
    text = file_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))

    try:
        headers = next(reader)
    except StopIteration:
        return ParseResult(rows=[], parser_notes={"error": "empty file"})

    cols = _map_columns(headers, REQUIRED_COLUMNS)
    opt = _map_columns(headers, OPTIONAL_COLUMNS)
    missing = [k for k in REQUIRED_COLUMNS if k not in cols]
    notes = {
        "headers_seen": headers,
        "columns_mapped": cols,
        "optional_columns_mapped": opt,
        "missing_required": missing,
    }
    if missing:
        return ParseResult(rows=[], parser_notes=notes)

    out: list[ParsedRow] = []
    for idx, row in enumerate(reader, start=1):
        if not any((c or "").strip() for c in row):
            continue

        def col(key: str, source: dict = cols) -> str:
            i = source.get(key)
            if i is None or i >= len(row):
                return ""
            return row[i].strip()

        raw = {h: (row[i] if i < len(row) else "") for i, h in enumerate(headers)}
        parsed = ParsedRow(index=idx, raw_payload=raw)

        meter_id = col("meter_id")
        site = col("site")
        start = _parse_date(col("period_start"))
        end = _parse_date(col("period_end"))
        consumption = _parse_decimal(col("consumption"))
        unit_raw = col("unit").upper() or "KWH"

        if not start or not end:
            parsed.error = "Unparseable billing period"
            out.append(parsed)
            continue
        if consumption is None:
            parsed.error = "Unparseable consumption value"
            out.append(parsed)
            continue
        multiplier = UNIT_TO_KWH.get(unit_raw)
        if multiplier is None:
            parsed.error = f"Unknown electricity unit {unit_raw!r}"
            out.append(parsed)
            continue

        findings: list[dict] = []
        if end < start:
            findings.append(finding(
                rule_id="period_inverted",
                severity="error",
                message="Billing period end is before start",
                field="period_end",
            ))
        period_days = (end - start).days + 1
        if period_days > 35 or period_days < 25:
            findings.append(finding(
                rule_id="period_atypical",
                severity="warning",
                message=f"Billing period of {period_days} days is outside normal monthly range (25–35)",
                field="period_end",
                observed=period_days,
            ))
        if consumption < 0:
            findings.append(finding(
                rule_id="negative_consumption",
                severity="warning",
                message="Negative consumption — possible solar export / credit row",
                field="normalized_value",
                observed=str(consumption),
            ))
        estimated_raw = col("estimated", opt).lower()
        if estimated_raw in ("true", "yes", "y", "1", "estimated"):
            findings.append(finding(
                rule_id="estimated_reading",
                severity="info",
                message="Reading marked estimated by utility (no physical meter read)",
                field="normalized_value",
            ))

        country = col("country", opt).upper() or ""

        parsed.canonical = Canonical(
            scope="scope_2",
            activity_type="electricity",
            period_start=start,
            period_end=end,
            original_value=consumption,
            original_unit=unit_raw,
            normalized_value=(consumption * multiplier).quantize(Decimal("0.0001")),
            normalized_unit="kWh",
            site_name=site,
            country=country,
            description=f"Meter {meter_id} {site}".strip(),
            parser_findings=findings,
        )
        out.append(parsed)

    return ParseResult(rows=out, parser_notes=notes)
