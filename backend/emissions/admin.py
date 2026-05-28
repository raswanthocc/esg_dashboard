from django.contrib import admin

from .models import (
    ActivityRecord,
    AirportCodeMap,
    AuditEvent,
    EmissionFactor,
    PlantCodeMap,
)


@admin.register(ActivityRecord)
class ActivityRecordAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "organization",
        "scope",
        "activity_type",
        "normalized_value",
        "normalized_unit",
        "co2e_kg",
        "status",
        "period_start",
        "period_end",
    )
    list_filter = ("scope", "status", "activity_type", "organization")


@admin.register(EmissionFactor)
class EmissionFactorAdmin(admin.ModelAdmin):
    list_display = ("activity_type", "unit", "region", "valid_year", "kg_co2e_per_unit", "source")
    list_filter = ("activity_type", "region", "valid_year")


@admin.register(PlantCodeMap)
class PlantCodeMapAdmin(admin.ModelAdmin):
    list_display = ("organization", "plant_code", "site_name", "country")
    list_filter = ("organization", "country")


@admin.register(AirportCodeMap)
class AirportCodeMapAdmin(admin.ModelAdmin):
    list_display = ("iata_code", "city", "country")


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = ("id", "activity_record", "action", "actor_label", "created_at")
    list_filter = ("action", "organization")
