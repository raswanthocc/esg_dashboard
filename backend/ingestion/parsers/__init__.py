"""Per-source parser registry.

A parser takes raw bytes and yields ParsedRow records — one per source row.
The orchestrator in ingestion.pipeline owns DB writes; parsers are pure so
they can be tested without a database. The mapping below is the only place
that knows which SourceType uses which parser.
"""

from ingestion.models import SourceType

from . import sap, travel, utility

PARSERS = {
    SourceType.SAP_FUEL: sap.parse,
    SourceType.UTILITY_ELECTRICITY: utility.parse,
    SourceType.TRAVEL_CONCUR: travel.parse,
}


def get_parser(source_type: str):
    if source_type not in PARSERS:
        raise ValueError(f"No parser registered for source_type={source_type!r}")
    return PARSERS[source_type]
