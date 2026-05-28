"""Validation / flagging rules — the analyst's review queue is built from
the findings this layer produces.

Each rule returns a list of structured finding dicts (see parsers/base.py
for the shape). Findings are queryable, groupable in the UI, and survive
schema changes — the analyst can filter "show me everything that tripped
value_out_of_range" without a string search.

Status semantics:
    failed   = couldn't parse at all (no ActivityRecord exists; lives on the
               RawRecord with a parse_error). Surfaced in the "Failures" view.
    flagged  = parsed and normalized, but at least one finding raised. Needs
               analyst attention before approval.
    pending  = parsed, no findings. Bulk-approve handles these.
    approved = locked.
    rejected = analyst explicitly removed from the report.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Callable

from django.db.models import Q

from emissions.models import ActivityRecord, ReviewStatus
from ingestion.parsers.base import finding


def _no_factor(ar: ActivityRecord) -> list[dict]:
    if ar.emission_factor is None:
        return [finding(
            rule_id="no_emission_factor",
            severity="error",
            message=f"No emission factor matched for "
                    f"{ar.activity_type}/{ar.normalized_unit}/{ar.country or 'GLOBAL'} "
                    f"in {ar.period_end.year} — CO2e cannot be computed",
        )]
    return []


# Activity-specific sanity bands. Loose on purpose — we want to flag the
# truly absurd, not be pedantic. Numbers picked to catch unit-of-measure
# mistakes (e.g., kWh entered as MWh) rather than narrowly police values.
RANGES = {
    "electricity": (Decimal("0"), Decimal("5000000"), "kWh"),
    "diesel": (Decimal("0"), Decimal("100000"), "L"),
    "petrol": (Decimal("0"), Decimal("100000"), "L"),
    "natural_gas": (Decimal("0"), Decimal("1000000"), "L"),
    "lpg": (Decimal("0"), Decimal("50000"), "kg"),
    "flight_short": (Decimal("0"), Decimal("3000"), "pkm"),
    "flight_medium": (Decimal("0"), Decimal("5000"), "pkm"),
    "flight_long": (Decimal("0"), Decimal("20000"), "pkm"),
}


def _value_range(ar: ActivityRecord) -> list[dict]:
    band = RANGES.get(ar.activity_type)
    if not band:
        return []
    lo, hi, unit = band
    if ar.normalized_unit != unit:
        return []
    out = []
    if ar.normalized_value < lo:
        out.append(finding(
            rule_id="value_out_of_range",
            severity="warning",
            message=f"Value {ar.normalized_value}{unit} is below plausible minimum {lo}{unit}",
            field="normalized_value",
            observed=str(ar.normalized_value),
            threshold=str(lo),
        ))
    if ar.normalized_value > hi:
        out.append(finding(
            rule_id="value_out_of_range",
            severity="warning",
            message=f"Value {ar.normalized_value}{unit} exceeds plausible maximum {hi}{unit} — unit mistake?",
            field="normalized_value",
            observed=str(ar.normalized_value),
            threshold=str(hi),
        ))
    return out


def _period_sanity(ar: ActivityRecord) -> list[dict]:
    if ar.period_end < ar.period_start:
        return [finding(
            rule_id="period_inverted",
            severity="error",
            message="Period end is before start",
            field="period_end",
        )]
    days = (ar.period_end - ar.period_start).days
    if days > 366:
        return [finding(
            rule_id="period_too_long",
            severity="warning",
            message=f"Period spans {days} days — multi-year is suspicious for a single row",
            field="period_end",
            observed=days,
        )]
    return []


def _duplicate_within_tenant(ar: ActivityRecord) -> list[dict]:
    """Flag if another record overlaps period for the same meter/site/activity.

    We only check within the *same* tenant. The lookup is cheap because the
    (organization, period_start) index covers it.
    """
    overlap_q = Q(period_start__lte=ar.period_end) & Q(period_end__gte=ar.period_start)
    qs = (
        ActivityRecord.objects.filter(
            organization=ar.organization,
            activity_type=ar.activity_type,
        )
        .filter(overlap_q)
        .exclude(pk=ar.pk)
    )
    if ar.site_name:
        qs = qs.filter(site_name=ar.site_name)
    elif ar.description:
        qs = qs.filter(description=ar.description)
    if qs.exists():
        other = qs.first()
        return [finding(
            rule_id="duplicate_period",
            severity="warning",
            message=f"Possible duplicate — overlaps record #{other.pk} "
                    f"({other.period_start}–{other.period_end})",
            field="period_start",
            observed=f"record #{other.pk}",
        )]
    return []


def _future_date(ar: ActivityRecord) -> list[dict]:
    from django.utils import timezone

    today = timezone.now().date()
    if ar.period_start > today + timedelta(days=1):
        return [finding(
            rule_id="future_date",
            severity="warning",
            message="Period start is in the future",
            field="period_start",
        )]
    return []


RULES: list[Callable[[ActivityRecord], list[dict]]] = [
    _no_factor,
    _value_range,
    _period_sanity,
    _duplicate_within_tenant,
    _future_date,
]


def validate(ar: ActivityRecord) -> None:
    """Run all rules, append findings, set status. Does not save — caller does."""
    new_findings = list(ar.flag_reasons)  # preserve parser-supplied findings
    for rule in RULES:
        try:
            new_findings.extend(rule(ar))
        except Exception as exc:
            new_findings.append(finding(
                rule_id="validator_internal_error",
                severity="error",
                message=f"Validator {rule.__name__} crashed: {exc}",
            ))
    ar.flag_reasons = new_findings
    # Any error- or warning-severity finding moves the row to FLAGGED.
    # Info-only findings (e.g. "estimated reading") leave it pending.
    has_blocker = any(f.get("severity") in ("warning", "error") for f in new_findings)
    if has_blocker and ar.status == ReviewStatus.PENDING:
        ar.status = ReviewStatus.FLAGGED
