from django.db import models


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Organization(TimeStampedModel):
    """A client tenant. Every domain row carries an `organization` FK.

    We model multi-tenancy at the schema level (one shared DB, tenant FK on every
    row, querysets scoped via middleware). We do NOT build a tenant admin UI —
    see TRADEOFFS.md.
    """

    slug = models.SlugField(unique=True, max_length=64)
    name = models.CharField(max_length=200)
    # The reporting fiscal-year start month (1-12). Most ESG reporting is
    # calendar year, but some clients use April-start fiscal years.
    fiscal_year_start_month = models.PositiveSmallIntegerField(default=1)
    # Default country code drives which region's emission factors apply
    # when a row doesn't specify one.
    default_country = models.CharField(max_length=2, default="IN")

    def __str__(self) -> str:
        return f"{self.name} ({self.slug})"


class AnalystUser(TimeStampedModel):
    """Lightweight analyst identity used only for audit attribution.

    We don't build real auth — see TRADEOFFS.md. The frontend just sends an
    `X-Analyst` header so we can stamp who approved a row. In production this
    would be the authenticated User from auth middleware.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="analysts"
    )
    email = models.EmailField()
    display_name = models.CharField(max_length=120)

    class Meta:
        unique_together = ("organization", "email")

    def __str__(self) -> str:
        return f"{self.display_name} <{self.email}>"
