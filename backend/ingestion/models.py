from django.db import models

from core.models import AnalystUser, Organization, TimeStampedModel


class SourceType(models.TextChoices):
    """The three source *types* the assignment calls out.

    Type is the schema/parser identifier, not the literal vendor — multiple
    utilities or travel platforms can share a parser if they fit the same
    canonical shape. New parsers add new choices.
    """

    SAP_FUEL = "sap_fuel", "SAP — Fuel & Procurement"
    UTILITY_ELECTRICITY = "utility_electricity", "Utility — Electricity"
    TRAVEL_CONCUR = "travel_concur", "Corporate Travel"


class BatchStatus(models.TextChoices):
    RECEIVED = "received", "Received"
    PARSING = "parsing", "Parsing"
    PARSED = "parsed", "Parsed"
    FAILED = "failed", "Failed"


class IngestionBatch(TimeStampedModel):
    """One upload event — the unit of provenance.

    Every RawRecord and ActivityRecord points back to its batch, so an
    analyst can answer "where did this number come from?" with one join.
    A batch is immutable once parsed; reprocessing creates a new batch.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="batches"
    )
    source_type = models.CharField(max_length=32, choices=SourceType.choices)
    original_filename = models.CharField(max_length=512)
    file_size_bytes = models.PositiveIntegerField()
    # SHA256 of the uploaded file — duplicate uploads are detected and
    # rejected at the API layer rather than silently double-counting.
    file_sha256 = models.CharField(max_length=64, db_index=True)
    uploaded_by = models.ForeignKey(
        AnalystUser, on_delete=models.SET_NULL, null=True, blank=True
    )
    status = models.CharField(
        max_length=16, choices=BatchStatus.choices, default=BatchStatus.RECEIVED
    )
    # Free-form parser notes (header detection, encoding, separator) so the
    # analyst can see *how* we read the file, not just what came out.
    parser_notes = models.JSONField(default=dict, blank=True)
    row_count_raw = models.PositiveIntegerField(default=0)
    row_count_normalized = models.PositiveIntegerField(default=0)
    row_count_failed = models.PositiveIntegerField(default=0)
    row_count_flagged = models.PositiveIntegerField(default=0)
    error_message = models.TextField(blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["organization", "-created_at"]),
            models.Index(fields=["organization", "file_sha256"]),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Batch #{self.pk} {self.source_type} {self.original_filename}"


class RawRecord(TimeStampedModel):
    """The original row as it appeared in the source file. Immutable.

    Stored as JSON so we don't lock our schema to one parser. If the analyst
    asks "what did the source actually say?", we show this verbatim alongside
    the normalized ActivityRecord. This separation is the audit anchor — we
    can re-derive ActivityRecords if factors or normalization rules change
    without touching what came in.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="raw_records"
    )
    batch = models.ForeignKey(
        IngestionBatch, on_delete=models.CASCADE, related_name="raw_records"
    )
    # 1-indexed row number in the source file (post-header) so analysts can
    # cross-reference against the original spreadsheet they uploaded.
    source_row_number = models.PositiveIntegerField()
    payload = models.JSONField()
    parse_error = models.TextField(blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["organization", "batch", "source_row_number"]),
        ]
        ordering = ["batch_id", "source_row_number"]

    def __str__(self) -> str:
        return f"RawRecord b{self.batch_id}#{self.source_row_number}"
