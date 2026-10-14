/**
 * placeSearchService.js
 * Backend proxy for universal place search: Nominatim (geocode) + OSRM (road distance).
 *
 * Why a proxy instead of direct frontend calls:
 * - Nominatim usage policy requires a valid User-Agent + max 1 req/sec; a shared
 *   backend can serialize + cache instead of every phone hammering the API.
 * - OSRM fan-out (one route lookup per search hit) is done server-side with
 *   `overview=false` so phones only receive tiny distance numbers, not geometries.
 * - No new npm dependencies: in-memory Map cache + global fetch + AbortController.
 */

const NOMINATIM_BASE = process.env.NOMINATIM_BASE || 'https://nominatim.openstreetmap.org';
const OSRM_BASE = process.env.OSRM_BASE || 'https://router.project-osrm.org';
const USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'UnityMap/1.0 (accessibility-map; contact: unitymap-local)';

const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000; // Nominatim results are stable
const DISTANCE_TTL_MS = 5 * 60 * 1000; // road distances go stale faster

const geoCache = new Map(); // key -> { at, value }
const distCache = new Map(); // key -> { at, value }

const cacheGet = (map, key, ttl) => {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > ttl) {
    map.delete(key);
    return null;
  }
  return entry.value;
};

const cacheSet = (map, key, value) => {
  map.set(key, { at: Date.now(), value });
  // Simple eviction so the map can't grow forever on a long-lived server.
  if (map.size > 500) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
};

const fetchJsonWithTimeout = async (url, { timeoutMs = 5000, headers = {} } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
    });
    if (!res.ok) throw new Error(`Upstream HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

// Wheelchair-paced ETA (flat-road assumption: external roads have no DB slope
// data). Mirrors frontend mapMath.calculateWheelchairETA(distanceM, 0).
const WHEELCHAIR_SPEED_MPS = 1.1;

const formatDistance = (meters) => {
  if (meters == null || Number.isNaN(Number(meters))) return '--';
  const m = Math.round(Number(meters));
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${m} m`;
};

const formatDuration = (minutes) => {
  if (minutes == null || Number.isNaN(Number(minutes))) return '--';
  const mins = Math.max(1, Math.round(Number(minutes)));
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'}`;
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  return r > 0 ? `${h} hr ${r} min${r === 1 ? '' : 's'}` : `${h} hr`;
};

const shortAddress = (result) => {
  const addr = result.address || {};
  const parts = [addr.suburb || addr.neighbourhood, addr.city || addr.town || addr.village, addr.country].filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  const display = String(result.display_name || '').split(',').slice(1, 4).join(',').trim();
  return display || 'Sri Lanka';
};

// Google-Maps-style one-line address: road + suburb + city (display_name minus name).
const addressShort = (result, name) => {
  const addr = result.address || {};
  const road = addr.road || addr.pedestrian || addr.footway || addr.cycleway || null;
  const area = addr.suburb || addr.neighbourhood || addr.village || addr.hamlet || null;
  const city = addr.city || addr.town || addr.state_district || null;
  const parts = [road, area, city].filter((p) => p && p !== name);
  if (parts.length > 0) return parts.join(', ');
  const display = String(result.display_name || '')
    .split(',')
    .slice(1, 4)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
  return display || shortAddress(result);
};

// Human-readable category labels for common OSM category/type pairs.
// Unknown pairs fall back to a title-cased type, then 'Place'.
const CATEGORY_LABELS = {
  'amenity/hospital': 'Hospital',
  'amenity/clinic': 'Clinic',
  'amenity/doctors': 'Clinic',
  'amenity/pharmacy': 'Pharmacy',
  'amenity/restaurant': 'Restaurant',
  'amenity/cafe': 'Cafe',
  'amenity/fast_food': 'Restaurant',
  'amenity/school': 'School',
  'amenity/university': 'University',
  'amenity/college': 'College',
  'amenity/library': 'Library',
  'amenity/bank': 'Bank',
  'amenity/atm': 'ATM',
  'amenity/fuel': 'Fuel Station',
  'amenity/parking': 'Parking',
  'amenity/police': 'Police',
  'amenity/post_office': 'Post Office',
  'amenity/place_of_worship': 'Worship',
  'amenity/marketplace': 'Market',
  'amenity/cinema': 'Cinema',
  'amenity/theatre': 'Theatre',
  'amenity/community_centre': 'Community Centre',
  'amenity/townhall': 'Town Hall',
  'amenity/fire_station': 'Fire Station',
  'amenity/bus_station': 'Bus Station',
  'amenity/ferry_terminal': 'Ferry Terminal',
  'shop/mall': 'Shopping Mall',
  'shop/supermarket': 'Supermarket',
  'shop/convenience': 'Convenience Store',
  'shop/department_store': 'Department Store',
  'shop/clothes': 'Clothing Store',
  'shop/books': 'Bookstore',
  'shop/electronics': 'Electronics Store',
  'tourism/hotel': 'Hotel',
  'tourism/hostel': 'Hostel',
  'tourism/guest_house': 'Guest House',
  'tourism/museum': 'Museum',
  'tourism/attraction': 'Attraction',
  'tourism/viewpoint': 'Viewpoint',
  'tourism/zoo': 'Zoo',
  'tourism/aquarium': 'Aquarium',
  'tourism/artwork': 'Artwork',
  'leisure/park': 'Park',
  'leisure/playground': 'Playground',
  'leisure/sports_centre': 'Sports Centre',
  'leisure/stadium': 'Stadium',
  'leisure/garden': 'Garden',
  'leisure/beach_resort': 'Beach',
  'natural/beach': 'Beach',
  'railway/station': 'Railway Station',
  'railway/halt': 'Railway Halt',
  'aeroway/aerodrome': 'Airport',
  'office/government': 'Government Office',
  'building/train_station': 'Railway Station',
  'highway/bus_stop': 'Bus Stop',
  'place/suburb': 'Area',
  'place/city': 'City',
  'place/town': 'Town',
  'place/village': 'Village',
  'boundary/administrative': 'Area',
};

const toTitleCase = (s) =>
  String(s || '')
    .split(/[_-]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');

const categoryLabel = (category, type) => {
  const key = `${category || ''}/${type || ''}`;
  if (CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
  if (type && type !== 'yes') return toTitleCase(type);
  if (category && category !== 'place') return toTitleCase(category);
  return 'Place';
};

// OSM wheelchair tag → tri-state (null when untagged — chip hidden on client).
const normalizeWheelchair = (extratags) => {
  const w = String(extratags?.wheelchair || '').toLowerCase().trim();
  if (['yes', 'designated'].includes(w)) return 'yes';
  if (['limited', 'partial'].includes(w)) return 'limited';
  if (['no'].includes(w)) return 'no';
  return null;
};

const parseBoundingBox = (bb) => {
  if (!Array.isArray(bb) || bb.length < 4) return null;
  const nums = bb.slice(0, 4).map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  // Nominatim order: [south, north, west, east]
  return { south: nums[0], north: nums[1], west: nums[2], east: nums[3] };
};

/**
 * Geocode via Nominatim. Returns up to `limit` raw results (cached 24h).
 */
const geocode = async (query, limit) => {
  const key = `geo|${query.toLowerCase().trim()}|${limit}`;
  const cached = cacheGet(geoCache, key, GEOCODE_TTL_MS);
  if (cached) return cached;

  const params = new URLSearchParams({
    format: 'jsonv2',
    q: query,
    addressdetails: '1',
    extratags: '1',
    limit: String(limit),
    countrycodes: 'lk',
    'accept-language': 'en',
  });
  const results = await fetchJsonWithTimeout(`${NOMINATIM_BASE}/search?${params.toString()}`, { timeoutMs: 6000 });
  const list = Array.isArray(results) ? results : [];
  cacheSet(geoCache, key, list);
  return list;
};

/**
 * Foot-routing road distance for one destination (cached 5min).
 * `overview=false` keeps the response tiny — we only need distance/duration.
 * Returns { roadDistanceM, roadDurationS } or null when OSRM is unreachable.
 */
const roadDistance = async (originLng, originLat, destLng, destLat) => {
  const key = `dist|${originLng.toFixed(4)},${originLat.toFixed(4)};${destLng.toFixed(4)},${destLat.toFixed(4)}`;
  const cached = cacheGet(distCache, key, DISTANCE_TTL_MS);
  if (cached) return cached;

  try {
    const url =
      `${OSRM_BASE}/route/v1/foot/${originLng},${originLat};${destLng},${destLat}` +
      `?overview=false&steps=false`;
    // Tight budget: typeahead callers fail over at ~10s total. A slow OSRM hit
    // degrades to '--' distance (full route is computed on select anyway).
    const data = await fetchJsonWithTimeout(url, { timeoutMs: 3500 });
    if (data && data.code === 'Ok' && Array.isArray(data.routes) && data.routes[0]) {
      const value = {
        roadDistanceM: Number(data.routes[0].distance) || null,
        roadDurationS: Number(data.routes[0].duration) || null,
      };
      if (value.roadDistanceM != null) cacheSet(distCache, key, value);
      return value.roadDistanceM != null ? value : null;
    }
  } catch (err) {
    // Fail soft: caller renders '--' and the full route is computed on select.
    console.warn('[placeSearchService] OSRM lookup failed:', err.message);
  }
  return null;
};

/**
 * Universal search: geocode + per-hit road distance from the user's origin.
 * Never throws for upstream hiccups — returns partial results with null distances.
 */
const searchPlaces = async ({ query, originLat, originLng, limit = 5 }) => {
  const geoResults = await geocode(query, limit);
  const places = geoResults
    .map((r) => {
      const lat = Number(r.lat);
      const lon = Number(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const name = String((r.display_name || query).split(',')[0] || query).trim() || query;
      const category = r.category || 'place';
      const type = r.type || '';
      const extra = r.address || {};
      return {
        placeId: String(r.place_id ?? `${lat},${lon}`),
        name,
        address: shortAddress(r),
        addressShort: addressShort(r, name),
        fullAddress: String(r.display_name || name),
        lat,
        lon,
        category: `${category}/${type}`,
        categoryLabel: categoryLabel(category, type),
        postcode: extra.postcode || null,
        // Google-Maps-style ranking: Nominatim importance (higher = better match).
        importance: Number.isFinite(Number(r.importance)) ? Number(r.importance) : 0,
        // Accessibility gold: OSM wheelchair tag (yes/limited/no, null = untagged).
        wheelchair: normalizeWheelchair(r.extratags),
        openingHours: r.extratags?.opening_hours || null,
        phone: r.extratags?.phone || r.extratags?.['contact:phone'] || null,
        website: r.extratags?.website || r.extratags?.['contact:website'] || null,
        boundingbox: parseBoundingBox(r.boundingbox),
      };
    })
    .filter(Boolean)
    // Best match first (Google-like ordering).
    .sort((a, b) => b.importance - a.importance);

  // Fan-out road distances; one slow/failing OSRM hit must not block the rest.
  const settled = await Promise.allSettled(
    places.map((p) => roadDistance(originLng, originLat, p.lon, p.lat))
  );

  return places.map((p, i) => {
    const road = settled[i] && settled[i].status === 'fulfilled' ? settled[i].value : null;
    const roadDistanceM = road && Number.isFinite(road.roadDistanceM) ? Math.round(road.roadDistanceM) : null;
    const etaMin =
      roadDistanceM != null ? Math.max(1, Math.round(roadDistanceM / WHEELCHAIR_SPEED_MPS / 60)) : null;
    return {
      ...p,
      roadDistanceM,
      roadDistanceText: roadDistanceM != null ? formatDistance(roadDistanceM) : '--',
      etaText: etaMin != null ? formatDuration(etaMin) : '--',
    };
  });
};

module.exports = { searchPlaces, formatDistance, formatDuration };
