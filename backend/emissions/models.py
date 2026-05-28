from decimal import Decimal

from django.db import models

from core.models import AnalystUser, Organization, TimeStampedModel
from ingestion.models import IngestionBatch, RawRecord


class Scope(models.TextChoices):
    """GHG Protocol scopes.

    Mapped one-to-one with our three source types in the prototype:
        SAP fuel        -> Scope 1 (direct combustion)
        Utility power   -> Scope 2 (purchased electricity)
        Business travel -> Scope 3 (value chain)

    Scope is stored on the ActivityRecord (not derived) because the same
    activity type can land in different scopes depending on contract terms
    — e.g., leased vehicles can be Scope 1 or Scope 3 depending on the
    operational/financial control boundary. The parser sets a default;
    analysts can re-categorize during review.
    """

    SCOPE_1 = "scope_1", "Scope 1 — Direct"
    SCOPE_2 = "scope_2", "Scope 2 — Purchased energy"
    SCOPE_3 = "scope_3", "Scope 3 — Value chain"


class ActivityType(models.TextChoices):
    """Canonical activity vocabulary. The parser maps source-specific codes
    (SAP MATNR, Concur expense category) into one of these so emission factor
    lookup is a simple FK and not a string-match heuristic.
    """

    DIESEL = "diesel", "Diesel fuel"
    PETROL = "petrol", "Petrol / Gasoline"
    NATURAL_GAS = "natural_gas", "Natural gas"
    LPG = "lpg", "LPG"
    ELECTRICITY = "electricity", "Grid electricity"
    FLIGHT_SHORT = "flight_short", "Flight — short haul"
    FLIGHT_MEDIUM = "flight_medium", "Flight — medium haul"
    FLIGHT_LONG = "flight_long", "Flight — long haul"
    HOTEL_NIGHT = "hotel_night", "Hotel — per night"
    TAXI = "taxi", "Taxi / ride-hail"
    RAIL = "rail", "Rail"
    OTHER = "other", "Other / unmapped"


class CanonicalUnit(models.TextChoices):
    LITRE = "L", "litre"
    KG = "kg", "kilogram"
    KWH = "kWh", "kilowatt-hour"
    PASSENGER_KM = "pkm", "passenger-kilometre"
    ROOM_NIGHT = "night", "room-night"
    KM = "km", "kilometre"


class EmissionFactor(TimeStampedModel):
    """One factor row: a (activity, unit, region, year) → kg CO2e per unit.

    Region/year-scoped because a kWh of grid electricity in India is not the
    same as Norway, and factors are republished yearly (DEFRA, IPCC, India
    CEA). We keep this table tiny and seed it — a full factor-library
    management UI is explicitly out of scope (see TRADEOFFS.md).
    """

    activity_type = models.CharField(max_length=32, choices=ActivityType.choices)
    unit = models.CharField(max_length=16, choices=CanonicalUnit.choices)
    region = models.CharField(max_length=8, help_text="ISO country code or 'GLOBAL'")
    valid_year = models.PositiveSmallIntegerField()
    kg_co2e_per_unit = models.DecimalField(max_digits=14, decimal_places=6)
    source = models.CharField(
        max_length=120,
        help_text="DEFRA 2024, India CEA v19, ICAO 2023, etc.",
    )

    class Meta:
        unique_together = ("activity_type", "unit", "region", "valid_year")
        indexes = [models.Index(fields=["activity_type", "region", "valid_year"])]

    def __str__(self) -> str:
        return f"{self.activity_type} {self.region} {self.valid_year}"


class PlantCodeMap(TimeStampedModel):
    """SAP plant code (WERKS) → human-readable site name + country.

    Plant codes are 4-character internal IDs ('IN01', 'DE07') that mean
    nothing to an analyst. We map them on ingest; unmapped codes raise a
    flag rather than dropping the row.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="plant_codes"
    )
    plant_code = models.CharField(max_length=8)
    site_name = models.CharField(max_length=200)
    country = models.CharField(max_length=2)

    class Meta:
        unique_together = ("organization", "plant_code")

    def __str__(self) -> str:
        return f"{self.plant_code} → {self.site_name}"


class AirportCodeMap(TimeStampedModel):
    """IATA airport code → city + lat/lon, for great-circle flight distance.

    Tenant-independent because IATA codes are global. Seeded with a small
    fixture covering the airports in our sample data; unmapped codes flag.
    """

    iata_code = models.CharField(max_length=3, unique=True)
    city = models.CharField(max_length=120)
    country = models.CharField(max_length=2)
    latitude = models.DecimalField(max_digits=8, decimal_places=5)
    longitude = models.DecimalField(max_digits=8, decimal_places=5)

    def __str__(self) -> str:
        return f"{self.iata_code} ({self.city})"


class ReviewStatus(models.TextChoices):
    PENDING = "pending", "Pending review"
    FLAGGED = "flagged", "Flagged — needs analyst attention"
    APPROVED = "approved", "Approved (locked)"
    REJECTED = "rejected", "Rejected"


class ActivityRecord(TimeStampedModel):
    """The normalized, reviewable, computed canonical row.

    One ActivityRecord per RawRecord (1:1 for successfully parsed rows;
    unparseable raws have no ActivityRecord and surface in the failures view).

    Provenance: `raw_record` links back to the immutable source row, `batch`
    to the upload event. `original_value` / `original_unit` are kept on the
    canonical row too so the analyst can see the conversion at a glance
    without expanding the raw payload.

    Approval = lock. Once status is APPROVED, the row is immutable; further
    edits require an explicit re-open (not built; would be a separate audit
    event). This is the audit anchor for sign-off.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="activity_records"
    )
    batch = models.ForeignKey(
        IngestionBatch, on_delete=models.CASCADE, related_name="activity_records"
    )
    raw_record = models.OneToOneField(
        RawRecord, on_delete=models.CASCADE, related_name="activity_record"
    )

    scope = models.CharField(max_length=16, choices=Scope.choices)
    activity_type = models.CharField(max_length=32, choices=ActivityType.choices)

    # The reporting period this activity applies to. Utility bills span
    # arbitrary ranges that don't align with calendar months — see how the
    # analyst dashboard splits these into calendar-month buckets when totaling.
    period_start = models.DateField()
    period_end = models.DateField()

    # Side-by-side: what came in vs. what we made of it.
    original_value = models.DecimalField(max_digits=18, decimal_places=4)
    original_unit = models.CharField(max_length=32)
    normalized_value = models.DecimalField(max_digits=18, decimal_places=4)
    normalized_unit = models.CharField(max_length=16, choices=CanonicalUnit.choices)

    emission_factor = models.ForeignKey(
        EmissionFactor, on_delete=models.PROTECT, null=True, blank=True
    )
    # Records *how* the factor was matched (exact (country, year) hit,
    # country-any-year fallback, GLOBAL fallback, or no match). Surfaces in
    # the UI so an auditor can see at a glance whether a Scope 2 row used
    # the country-specific grid factor or fell back to a global average.
    FACTOR_MATCH_CHOICES = [
        ("exact", "Exact (country + year)"),
        ("country_any_year", "Country, any year"),
        ("global", "Global fallback"),
        ("none", "No factor matched"),
    ]
    factor_match_strategy = models.CharField(
        max_length=24, choices=FACTOR_MATCH_CHOICES, default="none"
    )
    # Extra multiplier applied at CO2e compute time on top of the factor —
    # currently only used for flight cabin class (economy 1.0, business 2.9
    # per DEFRA). Stored so the inline calculation on the record detail page
    # is fully auditable: co2e = normalized_value × factor × multiplier.
    compute_multiplier = models.DecimalField(
        max_digits=6, decimal_places=2, default=Decimal("1.00")
    )
    co2e_kg = models.DecimalField(
        max_digits=18, decimal_places=4, null=True, blank=True
    )

    # Optional contextual fields. Not all sources fill all of these.
    site_name = models.CharField(max_length=200, blank=True)
    country = models.CharField(max_length=2, blank=True)
    description = models.CharField(max_length=500, blank=True)

    # Review state
    status = models.CharField(
        max_length=16, choices=ReviewStatus.choices, default=ReviewStatus.PENDING
    )
    # Human-readable reasons populated by validators — "Unit 'FU' unrecognized",
    # "Negative consumption", "Period spans 47 days, expected ≤ 35". Stored as
    # an array so multiple flags can stack on one row.
    flag_reasons = models.JSONField(default=list, blank=True)

    # Edit tracking (the row remembers if a human touched it post-import).
    edited_after_import = models.BooleanField(default=False)
    last_edited_by = models.ForeignKey(
        AnalystUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    last_edited_at = models.DateTimeField(null=True, blank=True)

    # Approval (lock) tracking
    approved_by = models.ForeignKey(
        AnalystUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["organization", "status", "scope"]),
            models.Index(fields=["organization", "period_start"]),
            models.Index(fields=["batch", "status"]),
        ]
        ordering = ["-period_end", "-id"]

    def __str__(self) -> str:
        return f"AR#{self.pk} {self.activity_type} {self.normalized_value}{self.normalized_unit}"

    @property
    def is_locked(self) -> bool:
        return self.status == ReviewStatus.APPROVED


class AuditAction(models.TextChoices):
    INGESTED = "ingested", "Ingested"
    FLAGGED = "flagged", "Flagged by validator"
    EDITED = "edited", "Edited by analyst"
    APPROVED = "approved", "Approved (locked)"
    REJECTED = "rejected", "Rejected"


class AuditEvent(TimeStampedModel):
    """Append-only log. Every state change on an ActivityRecord lands here.

    We don't use a generic history library because the audit trail is part
    of the product, not implementation detail — auditors will see this
    table. Storing before/after as JSON snapshots keeps it parser-agnostic
    and lets us replay history without joining other tables.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="audit_events"
    )
    activity_record = models.ForeignKey(
        ActivityRecord, on_delete=models.CASCADE, related_name="audit_events"
    )
    action = models.CharField(max_length=16, choices=AuditAction.choices)
    actor = models.ForeignKey(
        AnalystUser, on_delete=models.SET_NULL, null=True, blank=True
    )
    # "system" when actor is null (ingestion, automated flags).
    actor_label = models.CharField(max_length=200, default="system")
    before = models.JSONField(default=dict, blank=True)
    after = models.JSONField(default=dict, blank=True)
    note = models.CharField(max_length=500, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["organization", "-created_at"]),
            models.Index(fields=["activity_record", "-created_at"]),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Audit {self.action} on AR#{self.activity_record_id} by {self.actor_label}"


# Tiny helper used by parsers — kept here so the field reference stays
# discoverable via "find usages" on the model module.
ZERO = Decimal("0")
