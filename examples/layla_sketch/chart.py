"""Stubs for Layla's external integrations.

In GombiStar these live in:
  - services/geocode.py            (Google Geocoding API)
  - services/natal_chart.py        (flatlib / Swiss Ephemeris)

The sketch stubs them so what we're stressing is botella's Flow primitive,
not the integrations.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, time


@dataclass
class GeoCandidate:
    name: str
    lat: float
    lng: float
    timezone: str


_CITIES: dict[str, list[GeoCandidate]] = {
    "tel aviv": [GeoCandidate("Tel Aviv, Israel", 32.08, 34.78, "Asia/Jerusalem")],
    "haifa": [GeoCandidate("Haifa, Israel", 32.79, 34.99, "Asia/Jerusalem")],
    "springfield": [
        GeoCandidate("Springfield, IL, USA", 39.78, -89.65, "America/Chicago"),
        GeoCandidate("Springfield, MA, USA", 42.10, -72.59, "America/New_York"),
        GeoCandidate("Springfield, MO, USA", 37.21, -93.29, "America/Chicago"),
    ],
}


def geocode_city(query: str) -> list[GeoCandidate]:
    return list(_CITIES.get(query.strip().lower(), []))


_SUN_BY_MONTH = [
    "Capricorn", "Aquarius", "Pisces", "Aries", "Taurus", "Gemini",
    "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius",
]


def build_natal_chart(
    *,
    name: str,
    birth_date: date,
    birth_time: time | None,
    geo: GeoCandidate,
) -> dict:
    """Stub. The real flatlib chart has sun/moon/asc/houses/aspects."""
    return {
        "name": name,
        "birth_date": birth_date.isoformat(),
        "birth_time": birth_time.isoformat() if birth_time else None,
        "place": geo.name,
        "lat": geo.lat,
        "lng": geo.lng,
        "timezone": geo.timezone,
        "sun": _SUN_BY_MONTH[birth_date.month - 1],
    }
