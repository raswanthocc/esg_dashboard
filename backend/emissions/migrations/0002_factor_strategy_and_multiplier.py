from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("emissions", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="activityrecord",
            name="factor_match_strategy",
            field=models.CharField(
                choices=[
                    ("exact", "Exact (country + year)"),
                    ("country_any_year", "Country, any year"),
                    ("global", "Global fallback"),
                    ("none", "No factor matched"),
                ],
                default="none",
                max_length=24,
            ),
        ),
        migrations.AddField(
            model_name="activityrecord",
            name="compute_multiplier",
            field=models.DecimalField(
                decimal_places=2, default=Decimal("1.00"), max_digits=6
            ),
        ),
    ]
