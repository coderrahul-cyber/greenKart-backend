// src/utils/geocode.ts
// Two responsibilities:
//   1. geocodeAddress()       — converts a text address → { lat, lng } via Nominatim
//                               Uses progressive fallback queries for local Indian addresses
//                               that Nominatim doesn't know at street level
//   2. haversineDistanceKm()  — straight-line distance between two coordinates (km)

// ─── Haversine formula ────────────────────────────────────────────────────────
export const haversineDistanceKm = (
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number => {
  const R    = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const toRad = (deg: number) => (deg * Math.PI) / 180;

// ─── Single Nominatim request ─────────────────────────────────────────────────
// Returns { lat, lng } if found, null if not found, throws on network error.
const nominatimLookup = async (
  query: string
): Promise<{ lat: number; lng: number } | null> => {
  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encodeURIComponent(query)}` +
    `&format=json` +
    `&limit=1` +
    `&countrycodes=in` +   // restrict to India — improves accuracy a lot
    `&addressdetails=0`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":     "GreenKart-Backend/1.0",
      "Accept-Language": "en",
    },
  });

  if (!res.ok) throw new Error(`Nominatim error: ${res.status} ${res.statusText}`);

  const results = await res.json() as Array<{ lat: string; lon: string }>;
  if (!results || results.length === 0) return null;

  return {
    lat: parseFloat(results[0].lat),
    lng: parseFloat(results[0].lon),
  };
};

// ─── geocodeAddress — with progressive fallback ───────────────────────────────
// Indian local addresses (e.g. "Gali No. 5, Near Old Market") are often not
// in Nominatim's database. Instead of immediately rejecting, we try 3 queries
// from most-specific to least-specific:
//
//   Attempt 1 — full address:   "123 MG Road, Rewari, 123401"
//   Attempt 2 — city + pincode: "Rewari, 123401"
//   Attempt 3 — pincode only:   "123401, Haryana, India"
//
// A pincode covers ~5-10km in India — precise enough for an 8km radius check.
// If all 3 attempts fail → return null (caller rejects the registration).
//
// Also returns which level matched so the controller can log it for debugging.
export type GeocodePrecision = "full" | "city+pincode" | "pincode";

export const geocodeAddress = async (
  line1:   string,
  city:    string,
  pincode: string
): Promise<{ lat: number; lng: number; precision: GeocodePrecision } | null> => {

  // Attempt 1 — full address
  const full = await nominatimLookup(`${line1}, ${city}, ${pincode}`);
  if (full) return { ...full, precision: "full" };

  // Small delay between requests — Nominatim rate limit is 1 req/sec
  await sleep(1100);

  // Attempt 2 — city + pincode (drop the street line)
  const cityPin = await nominatimLookup(`${city}, ${pincode}`);
  if (cityPin) return { ...cityPin, precision: "city+pincode" };

  await sleep(1100);

  // Attempt 3 — pincode only with state hint
  // Most Indian pincodes geocode reliably at this level
  const pinOnly = await nominatimLookup(`${pincode}, India`);
  if (pinOnly) return { ...pinOnly, precision: "pincode" };

  // All 3 attempts failed
  return null;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));