export const AIRPORTS = {
  BOM: { city: "Mumbai", country: "IN", latitude: 19.08869, longitude: 72.86793 },
  DEL: { city: "Delhi", country: "IN", latitude: 28.55563, longitude: 77.09680 },
  BLR: { city: "Bengaluru", country: "IN", latitude: 13.19889, longitude: 77.70583 },
  MAA: { city: "Chennai", country: "IN", latitude: 12.99000, longitude: 80.16930 },
  DXB: { city: "Dubai", country: "AE", latitude: 25.25278, longitude: 55.36444 },
  LHR: { city: "London Heathrow", country: "GB", latitude: 51.47000, longitude: -0.45430 },
  JFK: { city: "New York JFK", country: "US", latitude: 40.63980, longitude: -73.77890 },
  SFO: { city: "San Francisco", country: "US", latitude: 37.62189, longitude: -122.37899 },
  FRA: { city: "Frankfurt", country: "DE", latitude: 50.03333, longitude: 8.57056 },
  SIN: { city: "Singapore Changi", country: "SG", latitude: 1.35019, longitude: 103.99411 },
  HKG: { city: "Hong Kong", country: "HK", latitude: 22.30800, longitude: 113.91850 }
};

export function haversineKm(lat1, lon1, lat2, lon2) {
  const r = 6371.0; // Earth radius in km
  const toRad = deg => (deg * Math.PI) / 180;
  
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dphi = toRad(lat2 - lat1);
  const dlmb = toRad(lon2 - lon1);

  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlmb / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  const distance = r * c;
  return Math.round(distance * 100) / 100; // Quantize to 2 decimals (Decimal('0.01') in Python)
}
