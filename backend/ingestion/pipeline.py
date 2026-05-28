"""End-to-end ingestion: bytes → RawRecord(s) + ActivityRecord(s) + audit.

Flow:
    1. Parser turns bytes into ParsedRow objects (raw + canonical or error).
    2. Pipeline writes a RawRecord per source row (always).
    3. For successfully parsed rows, build an ActivityRecord; look up the
       emission factor (capturing which fallback strategy fired); compute
       CO2e; resolve site/country via lookups.
    4. Validators run flagging rules — they may move status to FLAGGED.
    5. Pipeline writes an AuditEvent (action=INGESTED).
    6. Batch counters updated; everything happens in one transaction.
"""

from __future__ import annotations

import hashlib
from decimal import Decimal
from typing import Optional

from django.db import transaction

from core.models import AnalystUser, Organization
from emissions.models import (
    ActivityRecord,
    AuditAction,
    AuditEvent,
    EmissionFactor,
    PlantCodeMap,
    ReviewStatus,
)

from .models import BatchStatus, IngestionBatch, RawRecord
from .parsers import get_parser
from .parsers.base import Canonical, finding
from .validators import validate


class DuplicateUploadError(Exception):
    """Raised when a file with the same sha256 is uploaded twice for the
    same tenant and source. We refuse rather than silently double-counting."""


def _sha256(b: bytes) -> str:
    h = hashlib.sha256()
    h.update(b)
    return h.hexdigest()


def _resolve_factor(
    *,
    activity_type: str,
    unit: str,
    country: str,
    period_year: int,
) -> tuple[Optional[EmissionFactor], str]:
    """Returns (factor, match_strategy).

    Strategy values are stable identifiers the UI and audit log can render:
        exact            — (country, year) matched
        country_any_year — country matched, any year
        global           — fell back to GLOBAL region
        none             — nothing matched; co2e left null, row will flag
    """
    qs = EmissionFactor.objects.filter(activity_type=activity_type, unit=unit)
    if country:
        exact = qs.filter(region=country, valid_year=period_year).first()
        if exact:
            return exact, "exact"
        country_any = qs.filter(region=country).order_by("-valid_year").first()
        if country_any:
            return country_any, "country_any_year"
    global_any = qs.filter(region="GLOBAL").order_by("-valid_year").first()
    if global_any:
        return global_any, "global"
    return None, "none"


def _enrich_from_lookups(
    organization: Organization,
    canonical: Canonical,
) -> tuple[Canonical, list[dict]]:
    """Resolve SAP plant codes → site/country. Flag unmapped codes."""

    added: list[dict] = []
    plant_code = canonical.parser_hints.get("plant_code")
    if plant_code:
        try:
            plant = PlantCodeMap.objects.get(
                organization=organization, plant_code=plant_code
            )
            canonical.site_name = plant.site_name
            canonical.country = plant.country
        except PlantCodeMap.DoesNotExist:
            added.append(finding(
                rule_id="unmapped_plant_code",
                severity="warning",
                message=f"Unmapped SAP plant code {plant_code!r} — assign to a site in PlantCodeMap",
                field="site_name",
                observed=plant_code,
            ))

    if not canonical.country:
        canonical.country = organization.default_country

    return canonical, added


def ingest(
    *,
    organization: Organization,
    source_type: str,
    file_bytes: bytes,
    original_filename: str,
    uploaded_by: Optional[AnalystUser] = None,
) -> IngestionBatch:
    sha = _sha256(file_bytes)

    if IngestionBatch.objects.filter(
        organization=organization,
        source_type=source_type,
        file_sha256=sha,
    ).exists():
        raise DuplicateUploadError(
            f"This exact file (sha256={sha[:10]}…) was already uploaded for this source."
        )

    parser = get_parser(source_type)
    parse_result = parser(file_bytes)

    with transaction.atomic():
        batch = IngestionBatch.objects.create(
            organization=organization,
            source_type=source_type,
            original_filename=original_filename,
            file_size_bytes=len(file_bytes),
            file_sha256=sha,
            uploaded_by=uploaded_by,
            status=BatchStatus.PARSING,
            parser_notes=parse_result.parser_notes,
        )

        if not parse_result.rows:
            batch.status = BatchStatus.FAILED
            batch.error_message = (
                f"No rows parsed. Notes: {parse_result.parser_notes}"
            )
            batch.save()
            return batch

        counts = {"raw": 0, "normalized": 0, "failed": 0, "flagged": 0}

        for prow in parse_result.rows:
            counts["raw"] += 1
            raw = RawRecord.objects.create(
                organization=organization,
                batch=batch,
                source_row_number=prow.index,
                payload=prow.raw_payload,
                parse_error=prow.error or "",
            )
            if prow.error or not prow.canonical:
                counts["failed"] += 1
                continue

            canonical = prow.canonical
            canonical, lookup_findings = _enrich_from_lookups(organization, canonical)

            # Pull the compute_multiplier (cabin class for flights, 1.00
            # otherwise). Stored on the ActivityRecord so the inline CO2e
            # arithmetic on the record detail page is auditable.
            multiplier_raw = canonical.parser_hints.get("compute_multiplier", "1.00")
            multiplier = Decimal(str(multiplier_raw))

            period_year = canonical.period_end.year
            factor, match_strategy = _resolve_factor(
                activity_type=canonical.activity_type,
                unit=canonical.normalized_unit,
                country=canonical.country,
                period_year=period_year,
            )

            co2e = None
            if factor is not None:
                co2e = (
                    canonical.normalized_value
                    * factor.kg_co2e_per_unit
                    * multiplier
                ).quantize(Decimal("0.0001"))

            ar = ActivityRecord.objects.create(
                organization=organization,
                batch=batch,
                raw_record=raw,
                scope=canonical.scope,
                activity_type=canonical.activity_type,
                period_start=canonical.period_start,
                period_end=canonical.period_end,
                original_value=canonical.original_value,
                original_unit=canonical.original_unit,
                normalized_value=canonical.normalized_value,
                normalized_unit=canonical.normalized_unit,
                emission_factor=factor,
                factor_match_strategy=match_strategy,
                compute_multiplier=multiplier,
                co2e_kg=co2e,
                site_name=canonical.site_name,
                country=canonical.country,
                description=canonical.description,
                flag_reasons=canonical.parser_findings + lookup_findings,
            )
            counts["normalized"] += 1

            validate(ar)
            if ar.status == ReviewStatus.FLAGGED:
                counts["flagged"] += 1
            ar.save()

            AuditEvent.objects.create(
                organization=organization,
                activity_record=ar,
                action=AuditAction.INGESTED,
                actor=uploaded_by,
                actor_label=uploaded_by.email if uploaded_by else "system",
                after={
                    "status": ar.status,
                    "co2e_kg": str(ar.co2e_kg) if ar.co2e_kg is not None else None,
                    "factor_match_strategy": ar.factor_match_strategy,
                    "finding_count": len(ar.flag_reasons),
                },
                note=f"Ingested from batch #{batch.id}",
            )

        batch.row_count_raw = counts["raw"]
        batch.row_count_normalized = counts["normalized"]
        batch.row_count_failed = counts["failed"]
        batch.row_count_flagged = counts["flagged"]
        batch.status = BatchStatus.PARSED
        batch.save()
        return batch
