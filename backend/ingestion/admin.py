from django.contrib import admin

from .models import IngestionBatch, RawRecord


@admin.register(IngestionBatch)
class IngestionBatchAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "organization",
        "source_type",
        "original_filename",
        "status",
        "row_count_raw",
        "row_count_normalized",
        "row_count_failed",
        "row_count_flagged",
        "created_at",
    )
    list_filter = ("source_type", "status", "organization")


@admin.register(RawRecord)
class RawRecordAdmin(admin.ModelAdmin):
    list_display = ("id", "batch", "source_row_number", "parse_error")
    list_filter = ("batch__source_type",)
