const { searchPlaces } = require('../services/placeSearchService');

/**
 * Simple per-IP rate limiter (no new deps): 30 requests / minute / IP.
 * Protects the shared Nominatim quota (1 req/sec policy) from a single client
 * spamming keystrokes without debounce.
 */
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30;
const hitsByIp = new Map();

const isRateLimited = (ip) => {
  const now = Date.now();
  const entry = hitsByIp.get(ip);
  if (!entry || now - entry.start > WINDOW_MS) {
    hitsByIp.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
};

/**
 * @desc    Universal place search (Nominatim geocode + OSRM road distances)
 * @route   GET /api/places/search?q=&lat=&lon=&limit=
 * @access  Public (same as /api/nodes nearby lookups)
 */
exports.searchPlacesProxy = async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    if (isRateLimited(ip)) {
      return res.status(429).json({
        success: false,
        message: 'Too many search requests. Please pause typing for a moment and retry.',
      });
    }

    const q = String(req.query.q || '').trim();
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 8);

    if (q.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 3 characters.',
      });
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return res.status(400).json({
        success: false,
        message: 'Valid lat and lon origin coordinates are required to compute road distances.',
      });
    }

    const data = await searchPlaces({ query: q, originLat: lat, originLng: lon, limit });

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
      origin: { lat, lon },
      attribution: '© OpenStreetMap contributors (Nominatim + OSRM)',
    });
  } catch (error) {
    console.error('[placeSearchController] search failed:', error.message);
    // 200 with empty list would hide outages; 502 lets the frontend fall back
    // to local DB results with a clear banner.
    return res.status(502).json({
      success: false,
      message: 'Place search is temporarily unavailable. Showing saved places instead.',
      error: error.message,
    });
  }
};
