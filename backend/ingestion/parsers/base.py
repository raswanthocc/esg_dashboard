"""Shared types for source parsers.

A ParsedRow always has a `raw_payload` (what the source actually said, dict
form) and an `index` (1-based row number in the source file). If parsing
succeeded it also has a `canonical` dict with the normalized fields the
pipeline needs to build an ActivityRecord. If parsing failed, `error` is set
and the pipeline records a RawRecord with no ActivityRecord.

Findings (validator/parser flags) are structured dicts, not strings, so the
review UI can group by rule_id and the API can filter on rule type. Each
finding has shape:
    {
        "rule_id":  "value_out_of_range" | "duplicate_period" | …,
        "severity": "info" | "warning" | "error",
        "message":  "human-readable text shown in the UI",
        # optional, rule-specific:
        "field":    "normalized_value",
        "observed": "8500000",
        "threshold": "5000000",
    }
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Optional


@dataclass
class Canonical:
    """What every parser must produce for a successful row.

    `parser_findings` is a list of structured flag dicts the validator will
    extend. `parser_hints` carries opaque side-channel data the pipeline
    needs to enrich the record (SAP plant code, flight cabin multiplier) —
    it is NOT shown to the analyst.
    """

    scope: str
    activity_type: str
    period_start: date
    period_end: date
    original_value: Decimal
    original_unit: str
    normalized_value: Decimal
    normalized_unit: str
    site_name: str = ""
    country: str = ""
    description: str = ""
    parser_findings: list[dict] = field(default_factory=list)
    parser_hints: dict = field(default_factory=dict)


@dataclass
class ParsedRow:
    index: int
    raw_payload: dict
    canonical: Optional[Canonical] = None
    error: str = ""


@dataclass
class ParseResult:
    rows: list[ParsedRow]
    parser_notes: dict


def finding(rule_id: str, message: str, severity: str = "warning", **extra) -> dict:
    """Shorthand: every parser/validator that raises a flag uses this so
    the structure is consistent. Extra kwargs (`field`, `observed`,
    `threshold`) flow through to the rendered finding."""
    f = {"rule_id": rule_id, "severity": severity, "message": message}
    f.update(extra)
    return f
