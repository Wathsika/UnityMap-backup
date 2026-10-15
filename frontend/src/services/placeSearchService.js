import { apiRequest } from './api';

/**
 * placeSearchService.js — Universal place search via backend proxy.
 * GET /api/places/search?q=&lat=&lon=&limit= returns Nominatim hits enriched
 * with OSRM road distances from the user's origin (no API key needed).
 *
 * Road-distance-only policy: the list shows backend-computed road distances.
 * When the proxy is unreachable, callers fall back to local DB results.
 */

/**
 * Search any place by name. Aborts stale in-flight requests via `signal`.
 * @param {string} query - min 3 chars
 * @param {{latitude:number, longitude:number}} origin - user GPS position
 * @param {{limit?:number, signal?:AbortSignal}} options
 * @returns {Promise<Array>} normalized external places (empty on any failure)
 */
export const searchExternalPlaces = async (query, origin, options = {}) => {
  const q = String(query || '').trim();
  const lat = Number(origin?.latitude);
  const lon = Number(origin?.longitude);
  if (q.length < 3 || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];

  const limit = Math.min(Math.max(Number(options.limit) || 5, 1), 8);
  const params = new URLSearchParams({
    q,
    lat: String(lat),
    lon: String(lon),
    limit: String(limit),
  });

  try {
    const res = await apiRequest(`/places/search?${params.toString()}`, {
      // apiRequest builds its own AbortController per attempt; pass-through is
      // best-effort. Stale-response guarding is done by callers via request ids.
      ...(options.signal ? { signal: options.signal } : {}),
      // Typeahead budget: backend worst case ≈ Nominatim 6s + OSRM 3.5s parallel.
      // noFallback fails fast on the primary host instead of walking dead
      // hosts (~45s spinner) — the list falls back to local results + banner.
      timeoutMs: 10000,
      noFallback: true,
    });
    const list = Array.isArray(res?.data) ? res.data : [];
    return list
      .filter((p) => Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lon)))
      .map((p) => {
        const categoryLabel = String(p.categoryLabel || 'Place');
        return {
          id: `ext_${p.placeId}`,
          placeId: String(p.placeId),
          title: String(p.name || q),
          desc: String(p.addressShort || p.address || 'Sri Lanka'),
          address: String(p.address || 'Sri Lanka'),
          addressShort: String(p.addressShort || p.address || 'Sri Lanka'),
          fullAddress: String(p.fullAddress || p.address || 'Sri Lanka'),
          lat: Number(p.lat),
          lng: Number(p.lon),
          type: 'external',
          source: 'external',
          category: p.category || 'place',
          categoryLabel,
          icon: categoryIconName(categoryLabel, String(p.category || '')),
          postcode: p.postcode || null,
          importance: Number.isFinite(Number(p.importance)) ? Number(p.importance) : 0,
          // OSM wheelchair tag: 'yes' | 'limited' | 'no' | null (untagged → hide chip)
          wheelchair: ['yes', 'limited', 'no'].includes(p.wheelchair) ? p.wheelchair : null,
          openingHours: p.openingHours || null,
          phone: p.phone || null,
          website: p.website || null,
          boundingbox: normalizeBoundingBox(p.boundingbox),
          // Road distance chips (backend-computed, '--' when OSRM was unreachable)
          distance: p.roadDistanceText || '--',
          roadDistanceText: p.roadDistanceText || '--',
          roadDistanceM: Number.isFinite(Number(p.roadDistanceM)) ? Number(p.roadDistanceM) : null,
          etaText: p.etaText || '--',
        };
      });
  } catch (err) {
    // Throw (don't swallow): the caller distinguishes "proxy unreachable"
    // (banner) from "200 with zero hits" (no-matches hint).
    if (__DEV__) console.warn('[placeSearchService] external search failed, using local results:', err?.message || err);
    const proxyError = new Error('Place search unavailable');
    proxyError.cause = err;
    proxyError.isProxyUnreachable = true;
    throw proxyError;
  }
};

/**
 * Category label → { library, name } for result-row / detail-card icons.
 * Libraries: 'feather' | 'material' | 'fa5'. Callers render with the matching
 * icon set (all three are already used across the app).
 */
export const categoryIconName = (categoryLabel, categoryKey = '') => {
  const label = String(categoryLabel || '').toLowerCase();
  const key = String(categoryKey || '').toLowerCase();
  const has = (...words) => words.some((w) => label.includes(w) || key.includes(w));
  if (has('hospital', 'clinic', 'doctor', 'pharmacy')) return { library: 'fa5', name: 'hospital' };
  if (has('restaurant', 'cafe', 'food')) return { library: 'material', name: 'restaurant' };
  if (has('school', 'university', 'college', 'library')) return { library: 'feather', name: 'book-open' };
  if (has('bank', 'atm')) return { library: 'feather', name: 'credit-card' };
  if (has('hotel', 'hostel', 'guest house')) return { library: 'feather', name: 'home' };
  if (has('mall', 'supermarket', 'store', 'market', 'shop')) return { library: 'feather', name: 'shopping-bag' };
  if (has('park', 'garden', 'beach', 'playground')) return { library: 'feather', name: 'sun' };
  if (has('museum', 'cinema', 'theatre', 'attraction', 'zoo', 'aquarium', 'artwork', 'viewpoint')) return { library: 'feather', name: 'camera' };
  if (has('station', 'halt', 'bus stop', 'ferry', 'airport', 'aerodrome')) return { library: 'feather', name: 'navigation' };
  if (has('worship', 'church', 'mosque', 'temple', 'kovil')) return { library: 'feather', name: 'heart' };
  if (has('police', 'fire')) return { library: 'feather', name: 'shield' };
  if (has('parking', 'fuel')) return { library: 'feather', name: 'truck' };
  if (has('government', 'town hall', 'office', 'post office')) return { library: 'feather', name: 'briefcase' };
  if (has('sports', 'stadium')) return { library: 'feather', name: 'activity' };
  if (has('city', 'town', 'village', 'area', 'suburb')) return { library: 'feather', name: 'map-pin' };
  return { library: 'feather', name: 'map-pin' };
};

/**
 * OSM wheelchair tag → chip descriptor (null when untagged).
 */
export const wheelchairChip = (wheelchair) => {
  if (wheelchair === 'yes') return { text: 'Wheelchair accessible', bg: '#DCFCE7', color: '#16A34A', border: '#86EFAC' };
  if (wheelchair === 'limited') return { text: 'Limited access', bg: '#FEF3C7', color: '#D97706', border: '#FCD34D' };
  if (wheelchair === 'no') return { text: 'Not accessible', bg: '#FEE2E2', color: '#DC2626', border: '#FCA5A5' };
  return null;
};

/**
 * LOCAL DB search — the ~5k places table.
 * Search bar hits this FIRST (fast). Click result → lat/lng from DB → map pin.
 * @param {string} query - min 2 chars
 * @param {{latitude:number, longitude:number}} [origin] - optional nearby bias
 * @param {{limit?:number}} [options]
 * @returns {Promise<Array>} normalized local places (empty on any failure)
 */
export const searchLocalPlaces = async (query, origin, options = {}) => {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const limit = Math.min(Math.max(Number(options.limit) || 10, 1), 30);
  const params = new URLSearchParams({ q, limit: String(limit) });
  const lat = Number(origin?.latitude);
  const lon = Number(origin?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    params.set('lat', String(lat));
    params.set('lon', String(lon));
  }
  try {
    const res = await apiRequest(`/places/local/search?${params.toString()}`, {
      timeoutMs: 8000,
      noFallback: true,
    });
    const list = Array.isArray(res?.data) ? res.data : [];
    return list
      .filter((p) => Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lon)))
      .map((p) => {
        const latN = Number(p.lat);
        const lonN = Number(p.lon ?? p.lng);
        const categoryLabel = String(p.categoryLabel || p.category || 'Place');
        return {
          id: `local_${p._id || p.id}`,
          placeId: String(p._id || p.id),
          title: String(p.name || q),
          desc: String(p.address || p.city || 'Sri Lanka'),
          address: String(p.address || p.city || 'Sri Lanka'),
          addressShort: String(p.addressShort || p.address || p.city || 'Sri Lanka'),
          fullAddress: String(p.fullAddress || p.address || p.city || 'Sri Lanka'),
          lat: latN,
          lng: lonN,
          type: 'local',
          source: 'local',
          category: p.category || 'place',
          categoryLabel,
          icon: categoryIconName(categoryLabel, String(p.category || '')),
          postcode: p.postcode || null,
          phone: p.phone || null,
          wheelchair: ['yes', 'limited', 'no'].includes(p.wheelchair) ? p.wheelchair : null,
          boundingbox: null,
          distance: 'Saved',
          roadDistanceText: null,
          roadDistanceM: Number.isFinite(Number(p.distM)) ? Math.round(Number(p.distM)) : null,
          etaText: null,
        };
      });
  } catch (err) {
    if (__DEV__) console.warn('[placeSearchService] local search failed:', err?.message || err);
    return [];
  }
};

/** Fetch one local place by id — guarantees fresh lat/lon from DB for the map. */
export const getLocalPlaceById = async (placeId) => {
  const id = String(placeId || '').replace(/^local_/, '');
  if (!id) return null;
  try {
    const res = await apiRequest(`/places/local/${encodeURIComponent(id)}`, {
      timeoutMs: 8000,
      noFallback: true,
    });
    const p = res?.data;
    if (!p || !Number.isFinite(Number(p?.lat)) || !Number.isFinite(Number(p?.lon))) return null;
    const latN = Number(p.lat);
    const lonN = Number(p.lon ?? p.lng);
    const categoryLabel = String(p.categoryLabel || p.category || 'Place');
    return {
      id: `local_${p._id || p.id}`,
      placeId: String(p._id || p.id),
      title: String(p.name || ''),
      desc: String(p.address || p.city || 'Sri Lanka'),
      address: String(p.address || ''),
      addressShort: String(p.addressShort || p.address || ''),
      fullAddress: String(p.fullAddress || p.address || ''),
      lat: latN,
      lng: lonN,
      type: 'local',
      source: 'local',
      category: p.category || 'place',
      categoryLabel,
      icon: categoryIconName(categoryLabel, String(p.category || '')),
      postcode: p.postcode || null,
      phone: p.phone || null,
      wheelchair: ['yes', 'limited', 'no'].includes(p.wheelchair) ? p.wheelchair : null,
      boundingbox: null,
    };
  } catch (err) {
    if (__DEV__) console.warn('[placeSearchService] getLocalPlaceById failed:', err?.message || err);
    return null;
  }
};

const normalizeBoundingBox = (bb) => {
  if (!bb || typeof bb !== 'object') return null;
  const { south, north, west, east } = bb;
  if ([south, north, west, east].some((n) => !Number.isFinite(Number(n)))) return null;
  return { south: Number(south), north: Number(north), west: Number(west), east: Number(east) };
};

export default { searchExternalPlaces, searchLocalPlaces, getLocalPlaceById, categoryIconName, wheelchairChip };
