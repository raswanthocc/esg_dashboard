export const PLANTS = {
  IN01: { siteName: "Pune Plant", country: "IN" },
  IN02: { siteName: "Chennai Plant", country: "IN" },
  DE07: { siteName: "Munich Plant", country: "DE" },
  US12: { siteName: "Atlanta Plant", country: "US" }
};

export const FACTORS = [
  // Scope 1
  { activityType: "diesel", unit: "L", region: "GLOBAL", year: 2024, value: 2.687, source: "DEFRA 2024 (diesel avg)" },
  { activityType: "petrol", unit: "L", region: "GLOBAL", year: 2024, value: 2.310, source: "DEFRA 2024 (petrol avg)" },
  { activityType: "natural_gas", unit: "L", region: "GLOBAL", year: 2024, value: 0.002, source: "DEFRA 2024 (NG via liquid-equivalent)" },
  { activityType: "lpg", unit: "kg", region: "GLOBAL", year: 2024, value: 2.939, source: "DEFRA 2024 (LPG)" },

  // Scope 2
  { activityType: "electricity", unit: "kWh", region: "IN", year: 2024, value: 0.716, source: "India CEA v19 (FY23-24)" },
  { activityType: "electricity", unit: "kWh", region: "DE", year: 2024, value: 0.380, source: "EEA 2024 (Germany grid)" },
  { activityType: "electricity", unit: "kWh", region: "US", year: 2024, value: 0.371, source: "EPA eGRID 2024 (US avg)" },
  { activityType: "electricity", unit: "kWh", region: "GB", year: 2024, value: 0.207, source: "BEIS 2024 (UK grid)" },
  { activityType: "electricity", unit: "kWh", region: "GLOBAL", year: 2024, value: 0.475, source: "IEA 2024 (world avg fallback)" },

  // Scope 3 Flights
  { activityType: "flight_short", unit: "pkm", region: "GLOBAL", year: 2024, value: 0.158, source: "DEFRA 2024 (short-haul economy)" },
  { activityType: "flight_medium", unit: "pkm", region: "GLOBAL", year: 2024, value: 0.130, source: "DEFRA 2024 (domestic/medium economy)" },
  { activityType: "flight_long", unit: "pkm", region: "GLOBAL", year: 2024, value: 0.149, source: "DEFRA 2024 (long-haul economy)" },

  // Scope 3 Hotels
  { activityType: "hotel_night", unit: "night", region: "IN", year: 2024, value: 31.4, source: "Cornell Hotel Sustainability Benchmarking IN" },
  { activityType: "hotel_night", unit: "night", region: "GB", year: 2024, value: 10.4, source: "Cornell HSB UK" },
  { activityType: "hotel_night", unit: "night", region: "US", year: 2024, value: 17.5, source: "Cornell HSB US" },
  { activityType: "hotel_night", unit: "night", region: "GLOBAL", year: 2024, value: 20.0, source: "Cornell HSB global avg" },

  // Scope 3 Ground
  { activityType: "taxi", unit: "pkm", region: "GLOBAL", year: 2024, value: 0.149, source: "DEFRA 2024 (taxi avg)" },
  { activityType: "rail", unit: "pkm", region: "GLOBAL", year: 2024, value: 0.035, source: "DEFRA 2024 (national rail)" }
];

export function resolveFactor(activityType, unit, country, periodYear) {
  // Filter factors matching activityType and unit
  const matches = FACTORS.filter(f => f.activityType === activityType && f.unit === unit);
  if (matches.length === 0) {
    return { factor: null, strategy: "none" };
  }

  // 1. Exact match (country & year)
  if (country) {
    const exact = matches.find(f => f.region === country && f.year === periodYear);
    if (exact) return { factor: exact, strategy: "exact" };

    // 2. Country match (latest year)
    const countryMatches = matches.filter(f => f.region === country);
    if (countryMatches.length > 0) {
      countryMatches.sort((a, b) => b.year - a.year);
      return { factor: countryMatches[0], strategy: "country_any_year" };
    }
  }

  // 3. Global match (latest year)
  const globalMatches = matches.filter(f => f.region === "GLOBAL");
  if (globalMatches.length > 0) {
    globalMatches.sort((a, b) => b.year - a.year);
    return { factor: globalMatches[0], strategy: "global" };
  }

  return { factor: null, strategy: "none" };
}
