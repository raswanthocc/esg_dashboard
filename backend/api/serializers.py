from rest_framework import serializers

from core.models import Organization
from emissions.models import (
    ActivityRecord,
    AuditEvent,
    EmissionFactor,
)
from ingestion.models import IngestionBatch, RawRecord


class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ("id", "slug", "name", "default_country", "fiscal_year_start_month")


class IngestionBatchSerializer(serializers.ModelSerializer):
    source_type_display = serializers.CharField(
        source="get_source_type_display", read_only=True
    )

    class Meta:
        model = IngestionBatch
        fields = (
            "id",
            "source_type",
            "source_type_display",
            "original_filename",
            "file_size_bytes",
            "file_sha256",
            "status",
            "parser_notes",
            "row_count_raw",
            "row_count_normalized",
            "row_count_failed",
            "row_count_flagged",
            "error_message",
            "created_at",
        )


class RawRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = RawRecord
        fields = ("id", "source_row_number", "payload", "parse_error")


class EmissionFactorSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmissionFactor
        fields = ("id", "activity_type", "unit", "region", "valid_year", "kg_co2e_per_unit", "source")


class ActivityRecordSerializer(serializers.ModelSerializer):
    raw_record = RawRecordSerializer(read_only=True)
    emission_factor = EmissionFactorSerializer(read_only=True)
    scope_display = serializers.CharField(source="get_scope_display", read_only=True)
    activity_type_display = serializers.CharField(
        source="get_activity_type_display", read_only=True
    )
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    factor_match_strategy_display = serializers.CharField(
        source="get_factor_match_strategy_display", read_only=True
    )
    source_type = serializers.CharField(source="batch.source_type", read_only=True)
    is_locked = serializers.BooleanField(read_only=True)

    class Meta:
        model = ActivityRecord
        fields = (
            "id",
            "batch",
            "source_type",
            "scope",
            "scope_display",
            "activity_type",
            "activity_type_display",
            "period_start",
            "period_end",
            "original_value",
            "original_unit",
            "normalized_value",
            "normalized_unit",
            "emission_factor",
            "factor_match_strategy",
            "factor_match_strategy_display",
            "compute_multiplier",
            "co2e_kg",
            "site_name",
            "country",
            "description",
            "status",
            "status_display",
            "flag_reasons",
            "edited_after_import",
            "raw_record",
            "is_locked",
            "approved_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "batch",
            "source_type",
            "raw_record",
            "emission_factor",
            "factor_match_strategy",
            "factor_match_strategy_display",
            "compute_multiplier",
            "co2e_kg",
            "edited_after_import",
            "is_locked",
            "approved_at",
            "created_at",
            "updated_at",
        )


class AuditEventSerializer(serializers.ModelSerializer):
    action_display = serializers.CharField(source="get_action_display", read_only=True)

    class Meta:
        model = AuditEvent
        fields = (
            "id",
            "action",
            "action_display",
            "actor_label",
            "before",
            "after",
            "note",
            "created_at",
        )
