"""SAP fuel & procurement flat-file parser.

What real SAP exports look like (SE16/SQVI/MB51 dumps):
    - Semicolon separator (German locale default), occasionally tab
    - latin-1 / cp1252 encoding (umlauts in Materialkurztext)
    - Decimal comma: "1.234,56"
    - Dates as DD.MM.YYYY
    - Plant codes (WERKS) like 'IN01' / 'DE07' — meaningless without lookup
    - Material numbers (MATNR) left-padded with zeros to 18 chars
    - Headers in German *or* English depending on SAP GUI locale; we accept both

What we handle here: a single export shape covering material movements for
fuels (diesel, petrol, LPG, natural gas). We pick the activity type by
matching keywords in the material description — crude, but it's what SAP
deployments without a custom emissions extension actually look like.

What we ignore: IDoc/XML, OData, currency conversion, GL postings, anything
that isn't a fuel material. See SOURCES.md.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Optional

from .base import Canonical, ParsedRow, ParseResult, finding

# Map both German and English header variants to a single canonical key.
# Order matters only for documentation — we accept any case.
HEADER_ALIASES = {
    "material": ["material", "materialnummer", "matnr"],
    "description": ["description", "materialkurztext", "material description", "kurztext"],
    "plant": ["plant", "werk", "werks"],
    "quantity": ["quantity", "menge", "qty"],
    "unit": ["unit", "uom", "mengeneinheit", "meins", "base unit"],
    "posting_date": ["posting date", "buchungsdatum", "budat", "doc date"],
    "movement_type": ["movement type", "bewegungsart", "bwart"],
}

# SAP MEINS codes we know how to canonicalize. SAP supports hundreds of UoMs;
# anything outside this set flags the row rather than silently dropping it.
UNIT_TO_CANONICAL = {
    "L": ("L", Decimal("1")),
    "LTR": ("L", Decimal("1")),
    "LITRE": ("L", Decimal("1")),
    "LITER": ("L", Decimal("1")),
    "ML": ("L", Decimal("0.001")),
    "M3": ("L", Decimal("1000")),  # cubic metres of fuel as liquid — sample contains gas in m3 too
    "KG": ("kg", Decimal("1")),
    "G": ("kg", Decimal("0.001")),
    "T": ("kg", Decimal("1000")),
}

# Activity inference from material description.
# Order matters: 'natural gas' must be checked before 'gas' alone (we don't
# have a bare 'gas' rule, but the principle stands — narrowest first).
ACTIVITY_KEYWORDS = [
    ("diesel", "diesel"),
    ("hsd", "diesel"),          # High-Speed Diesel — common in IN procurement
    ("petrol", "petrol"),
    ("gasoline", "petrol"),
    ("ms ", "petrol"),          # 'MS ' = Motor Spirit in Indian SAP
    ("natural gas", "natural_gas"),
    ("png", "natural_gas"),
    ("cng", "natural_gas"),
    ("lpg", "lpg"),
    ("propane", "lpg"),
]


def _detect_separator(sample: str) -> str:
    """SAP exports are typically ';' (German) but occasionally tab/CSV."""
    for sep in (";", "\t", ","):
        if sep in sample.splitlines()[0]:
            return sep
    return ";"


def _decode_bytes(raw: bytes) -> tuple[str, str]:
    """Try utf-8, fall back to latin-1. Return (text, encoding_used)."""
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(enc), enc
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", errors="replace"), "latin-1-lossy"


def _normalize_header(h: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", h.strip().lower())


def _build_header_map(headers: list[str]) -> dict[str, int]:
    """Map our canonical keys (material, plant, ...) to source column index."""
    norm_to_idx = {_normalize_header(h): i for i, h in enumerate(headers)}
    out = {}
    for canonical_key, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            n = _normalize_header(alias)
            if n in norm_to_idx:
                out[canonical_key] = norm_to_idx[n]
                break
    return out


def _parse_german_decimal(s: str) -> Optional[Decimal]:
    """'1.234,56' or '1234.56' or '1234' → Decimal. None if unparseable."""
    if not s:
        return None
    s = s.strip()
    if not s:
        return None
    # If both '.' and ',' appear, '.' is thousands, ',' is decimal (German).
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        # Could be decimal comma OR thousands comma — in SAP exports it's
        # virtually always decimal. Treat it that way; the analyst sees the
        # original value side by side so a mistake is visible.
        s = s.replace(",", ".")
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def _parse_sap_date(s: str):
    s = (s or "").strip()
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y", "%Y%m%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _infer_activity(description: str) -> str:
    desc = (description or "").lower()
    for keyword, activity in ACTIVITY_KEYWORDS:
        if keyword in desc:
            return activity
    return "other"


def parse(file_bytes: bytes) -> ParseResult:
    text, encoding = _decode_bytes(file_bytes)
    sep = _detect_separator(text[:2048])
    reader = csv.reader(io.StringIO(text), delimiter=sep)

    try:
        headers = next(reader)
    except StopIteration:
        return ParseResult(rows=[], parser_notes={"error": "empty file"})

    header_map = _build_header_map(headers)
    missing_required = [
        k for k in ("material", "plant", "quantity", "unit", "posting_date")
        if k not in header_map
    ]
    notes = {
        "encoding": encoding,
        "separator": repr(sep),
        "headers_seen": headers,
        "header_map": header_map,
        "missing_required_headers": missing_required,
    }
    if missing_required:
        # Bail early — without these fields we can't normalize any row.
        return ParseResult(rows=[], parser_notes=notes)

    out: list[ParsedRow] = []
    for idx, row in enumerate(reader, start=1):
        if not any((c or "").strip() for c in row):
            continue  # skip blank lines

        def col(key: str) -> str:
            i = header_map.get(key)
            if i is None or i >= len(row):
                return ""
            return row[i].strip()

        raw = {h: (row[i] if i < len(row) else "") for i, h in enumerate(headers)}
        parsed = ParsedRow(index=idx, raw_payload=raw)

        material = col("material").lstrip("0") or col("material")
        description = col("description")
        plant = col("plant")
        unit_raw = col("unit").upper()
        qty = _parse_german_decimal(col("quantity"))
        posting = _parse_sap_date(col("posting_date"))

        if qty is None:
            parsed.error = f"Unparseable quantity: {col('quantity')!r}"
            out.append(parsed)
            continue
        if posting is None:
            parsed.error = f"Unparseable date: {col('posting_date')!r}"
            out.append(parsed)
            continue

        activity = _infer_activity(description)
        findings: list[dict] = []
        if activity == "other":
            findings.append(finding(
                rule_id="activity_inference_failed",
                severity="warning",
                message=f"Could not infer activity type from description {description!r} — defaulted to 'other'",
                field="activity_type",
                observed=description,
            ))

        canonical_unit_info = UNIT_TO_CANONICAL.get(unit_raw)
        if not canonical_unit_info:
            parsed.error = f"Unknown SAP unit of measure {unit_raw!r}"
            out.append(parsed)
            continue
        normalized_unit, multiplier = canonical_unit_info

        # SAP fuel postings are typically a single posting date, so we
        # treat period_start == period_end. Aggregating to monthly periods
        # is a downstream concern (analyst dashboard does the bucketing).
        parsed.canonical = Canonical(
            scope="scope_1",
            activity_type=activity,
            period_start=posting,
            period_end=posting,
            original_value=qty,
            original_unit=unit_raw,
            normalized_value=(qty * multiplier).quantize(Decimal("0.0001")),
            normalized_unit=normalized_unit,
            site_name="",  # Filled in by normalizer via PlantCodeMap lookup.
            country="",
            description=f"{material} {description}".strip(),
            parser_findings=findings,
            parser_hints={"plant_code": plant} if plant else {},
        )
        out.append(parsed)

    return ParseResult(rows=out, parser_notes=notes)
