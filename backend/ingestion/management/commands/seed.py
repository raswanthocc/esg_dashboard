"""Seed demo data: one tenant, lookup tables, emission factors.

Run after migrate. Idempotent: re-running won't duplicate rows because every
upsert uses get_or_create on a stable natural key.

We seed:
    - 'Acme Industries' as the demo tenant (slug: acme)
    - SAP plant codes for Acme's sites (IN/DE/US)
    - A small airport table covering our sample data
    - DEFRA-style emission factors for the activities the parsers produce

Factor numbers below are illustrative — sourced from published DEFRA 2024
and India CEA factors but rounded for the prototype. SOURCES.md is the
source of truth for which factor came from where.
"""

from decimal import Decimal

from django.core.management.base import BaseCommand

from core.models import AnalystUser, Organization
from emissions.models import AirportCodeMap, EmissionFactor, PlantCodeMap


PLANTS = [
    ("IN01", "Pune Plant", "IN"),
    ("IN02", "Chennai Plant", "IN"),
    ("DE07", "Munich Plant", "DE"),
    ("US12", "Atlanta Plant", "US"),
]


AIRPORTS = [
    # (iata, city, country, lat, lon) — covers the sample travel file.
    ("BOM", "Mumbai", "IN", 19.08869, 72.86793),
    ("DEL", "Delhi", "IN", 28.55563, 77.09680),
    ("BLR", "Bengaluru", "IN", 13.19889, 77.70583),
    ("MAA", "Chennai", "IN", 12.99000, 80.16930),
    ("DXB", "Dubai", "AE", 25.25278, 55.36444),
    ("LHR", "London Heathrow", "GB", 51.47000, -0.45430),
    ("JFK", "New York JFK", "US", 40.63980, -73.77890),
    ("SFO", "San Francisco", "US", 37.62189, -122.37899),
    ("FRA", "Frankfurt", "DE", 50.03333, 8.57056),
    ("SIN", "Singapore Changi", "SG", 1.35019, 103.99411),
    ("HKG", "Hong Kong", "HK", 22.30800, 113.91850),
]


# (activity_type, unit, region, year, kg_co2e_per_unit, source)
FACTORS = [
    # Scope 1 — fuel combustion. DEFRA 2024 values for stationary combustion,
    # rounded. Real factors split by fuel grade; we use one number per fuel.
    ("diesel", "L", "GLOBAL", 2024, Decimal("2.687"), "DEFRA 2024 (diesel avg)"),
    ("petrol", "L", "GLOBAL", 2024, Decimal("2.310"), "DEFRA 2024 (petrol avg)"),
    ("natural_gas", "L", "GLOBAL", 2024, Decimal("0.002"), "DEFRA 2024 (NG via liquid-equivalent — see SOURCES.md)"),
    ("lpg", "kg", "GLOBAL", 2024, Decimal("2.939"), "DEFRA 2024 (LPG)"),

    # Scope 2 — grid electricity, country-specific.
    ("electricity", "kWh", "IN", 2024, Decimal("0.716"), "India CEA v19 (FY23-24)"),
    ("electricity", "kWh", "DE", 2024, Decimal("0.380"), "EEA 2024 (Germany grid)"),
    ("electricity", "kWh", "US", 2024, Decimal("0.371"), "EPA eGRID 2024 (US avg)"),
    ("electricity", "kWh", "GB", 2024, Decimal("0.207"), "BEIS 2024 (UK grid)"),
    ("electricity", "kWh", "GLOBAL", 2024, Decimal("0.475"), "IEA 2024 (world avg fallback)"),

    # Scope 3 — flights (per passenger-km, economy baseline). Cabin
    # multiplier is applied in the pipeline, not stored per-factor.
    ("flight_short", "pkm", "GLOBAL", 2024, Decimal("0.158"), "DEFRA 2024 (short-haul economy)"),
    ("flight_medium", "pkm", "GLOBAL", 2024, Decimal("0.130"), "DEFRA 2024 (domestic/medium economy)"),
    ("flight_long", "pkm", "GLOBAL", 2024, Decimal("0.149"), "DEFRA 2024 (long-haul economy)"),

    # Scope 3 — hotels (kg CO2e per room-night, country-specific).
    ("hotel_night", "night", "IN", 2024, Decimal("31.4"), "Cornell Hotel Sustainability Benchmarking IN"),
    ("hotel_night", "night", "GB", 2024, Decimal("10.4"), "Cornell HSB UK"),
    ("hotel_night", "night", "US", 2024, Decimal("17.5"), "Cornell HSB US"),
    ("hotel_night", "night", "GLOBAL", 2024, Decimal("20.0"), "Cornell HSB global avg"),

    # Scope 3 — ground transport (passenger-km).
    ("taxi", "pkm", "GLOBAL", 2024, Decimal("0.149"), "DEFRA 2024 (taxi avg)"),
    ("rail", "pkm", "GLOBAL", 2024, Decimal("0.035"), "DEFRA 2024 (national rail)"),
]


class Command(BaseCommand):
    help = "Seed demo tenant, lookups, and emission factors. Idempotent."

    def handle(self, *args, **opts):
        org, created = Organization.objects.get_or_create(
            slug="acme",
            defaults={
                "name": "Acme Industries",
                "default_country": "IN",
                "fiscal_year_start_month": 4,
            },
        )
        self.stdout.write(self.style.SUCCESS(
            f"{'Created' if created else 'Found'} tenant: {org}"
        ))

        AnalystUser.objects.get_or_create(
            organization=org,
            email="analyst@acme.example",
            defaults={"display_name": "Demo Analyst"},
        )

        for code, name, country in PLANTS:
            PlantCodeMap.objects.update_or_create(
                organization=org,
                plant_code=code,
                defaults={"site_name": name, "country": country},
            )
        self.stdout.write(f"Seeded {len(PLANTS)} plant codes for {org.slug}.")

        for iata, city, country, lat, lon in AIRPORTS:
            AirportCodeMap.objects.update_or_create(
                iata_code=iata,
                defaults={
                    "city": city,
                    "country": country,
                    "latitude": Decimal(str(lat)),
                    "longitude": Decimal(str(lon)),
                },
            )
        self.stdout.write(f"Seeded {len(AIRPORTS)} airports.")

        for activity, unit, region, year, value, src in FACTORS:
            EmissionFactor.objects.update_or_create(
                activity_type=activity,
                unit=unit,
                region=region,
                valid_year=year,
                defaults={"kg_co2e_per_unit": value, "source": src},
            )
        self.stdout.write(f"Seeded {len(FACTORS)} emission factors.")
        self.stdout.write(self.style.SUCCESS("Seed complete."))
