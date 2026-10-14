const Place = require('../models/Place');

const escapeRegex = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @desc    Search local places table (the ~5k DB table the search bar uses).
 *          Click result → use its lat/lon to show location on map.
 * @route   GET /api/places/local/search?q=&limit=&lat=&lon=
 * @access  Public
 */
exports.searchLocalPlaces = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 30);
    const lat = req.query.lat !== undefined ? Number(req.query.lat) : NaN;
    const lon = req.query.lon !== undefined ? Number(req.query.lon) : NaN;
    const hasOrigin = Number.isFinite(lat) && Number.isFinite(lon);

    if (q.length < 2) {
      return res.status(400).json({ success: false, message: 'Search query must be at least 2 characters.' });
    }

    const safe = escapeRegex(q);
    const rx = new RegExp(safe, 'i');

    // Prefix matches rank first: build two buckets then concat.
    const orFilter = { $or: [{ name: rx }, { address: rx }, { city: rx }, { category: rx }, { categoryLabel: rx }] };

    let query = Place.find(orFilter).limit(limit * 2).lean();

    // Optional nearby bias: if origin given, sort by geo distance.
    if (hasOrigin) {
      query = Place.aggregate([
        {
          $geoNear: {
            near: { type: 'Point', coordinates: [lon, lat] },
            distanceField: 'distM',
            spherical: true,
            query: orFilter,
          },
        },
        { $limit: limit },
      ]);
      const data = await query;
      return res.status(200).json({
        success: true,
        count: data.length,
        data: data.map(toClient),
      });
    }

    const docs = await query;
    // Rank: name-starts-with > name-contains > rest, then newest.
    const lower = q.toLowerCase();
    docs.sort((a, b) => rank(a, lower) - rank(b, lower));
    const data = docs.slice(0, limit);

    return res.status(200).json({ success: true, count: data.length, data: data.map(toClient) });
  } catch (error) {
    console.error('[placeLocalController] search failed:', error.message);
    return res.status(500).json({ success: false, message: 'Local place search failed.', error: error.message });
  }
};

/**
 * @desc    Get one local place by id — returns lat/lon for map pin.
 * @route   GET /api/places/local/:id
 * @access  Public
 */
exports.getLocalPlaceById = async (req, res) => {
  try {
    const doc = await Place.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Place not found.' });
    return res.status(200).json({ success: true, data: toClient(doc) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load place.', error: error.message });
  }
};

/** @desc Count rows in local places table (to verify ~5k seed). GET /api/places/local/count */
exports.countLocalPlaces = async (req, res) => {
  try {
    const count = await Place.estimatedDocumentCount();
    return res.status(200).json({ success: true, count });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Count failed.', error: error.message });
  }
};

/** Normalize DB doc → frontend shape (lat/lng = map position). */
function toClient(d) {
  const lat = Number(d.lat ?? d.location?.coordinates?.[1]);
  const lon = Number(d.lon ?? d.location?.coordinates?.[0]);
  return {
    _id: String(d._id),
    id: String(d._id),
    name: d.name,
    address: d.address || '',
    addressShort: d.address || d.city || 'Sri Lanka',
    fullAddress: [d.name, d.address, d.city, d.district].filter(Boolean).join(', '),
    city: d.city || '',
    district: d.district || '',
    category: d.category || 'place',
    categoryLabel: d.categoryLabel || 'Place',
    lat,
    lon,
    lng: lon,
    latitude: lat,
    longitude: lon,
    location: d.location || { type: 'Point', coordinates: [lon, lat] },
    postcode: d.postcode || null,
    phone: d.phone || null,
    wheelchair: d.wheelchair || null,
    source: 'local',
    type: 'local',
  };
}

function rank(doc, lower) {
  const name = String(doc.name || '').toLowerCase();
  if (name.startsWith(lower)) return 0;
  if (name.includes(lower)) return 1;
  const city = String(doc.city || '').toLowerCase();
  if (city.includes(lower)) return 2;
  return 3;
}
