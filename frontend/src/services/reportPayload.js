/**
 * reportPayload.js — SPT-206 Report Payload Packaging & API Integration
 *
 * Single owner of the volunteer barrier-report payload contract shared by
 * ThreeTapReportScreen (volunteer flow) and AdminAddReportModal (admin flow).
 *
 * Responsibilities:
 *  - buildBarrierReportPayload(): merge EXIF GPS/timestamp, device/map fallback
 *    coordinates, category chip, star rating, notes and photo into the exact
 *    MongoDB-aligned document POSTed to /api/reports (JSON `photoUrl` or
 *    multipart `photo` part — never both, never a device-local URI as URL).
 *  - validateBarrierReportPayload(): client-side mirror of the backend 400
 *    rules in reportController.js so the UI fails fast with field errors
 *    instead of round-tripping.
 *  - normalizePhotoPart() / resolveMimeType(): platform-correct multipart
 *    shaping (native { uri, name, type } vs web File/Blob).
 *
 * Pure module: no React, no React-Native imports — the platform is injected
 * (`platformOs: 'web' | 'ios' | 'android'`) so this file is unit-testable in
 * plain Node. Mirrors backend/src/controllers/reportController.js validation.
 */

import { toBarrierReportFields } from '../utils/exifHelper';

export const REPORT_CATEGORIES = ['Ramp', 'Lift', 'Tactile Paving', 'Restroom', 'Other'];
export const REPORT_CONDITIONS = ['good', 'bad'];
export const DEFAULT_CENTER = { latitude: 6.9271, longitude: 79.8612 }; // Colombo

const EXT_MIME_MAP = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

/**
 * Resolve a MIME type from a URI extension, trusting an explicitly declared
 * non-default type. Never throws; always returns a usable image MIME.
 */
export function resolveMimeType(uri, declared) {
  if (declared && declared !== 'image/jpeg') return declared;
  try {
    const clean = String(uri || '').split('?')[0].split('#')[0];
    const ext = clean.split('.').pop()?.toLowerCase();
    if (ext && EXT_MIME_MAP[ext]) return EXT_MIME_MAP[ext];
  } catch {}
  return declared || 'image/jpeg';
}

/**
 * Sanitize reporterId: demo/offline ids (e.g. 'UM-123') are not Mongo
 * ObjectIds — submit anonymously so the save succeeds instead of 500ing
 * on a CastError. Mirrors the backend guard in reportController.js.
 */
export function sanitizeReporterId(raw) {
  return typeof raw === 'string' && /^[0-9a-fA-F]{24}$/.test(raw) ? raw : undefined;
}

const isDeviceLocalUri = (uri) =>
  typeof uri === 'string' && /^(file|content|ph):\/\//i.test(uri);

/**
 * Normalize a photo attachment to the exact multipart part shape api.js
 * expects. Returns null when there is no photo.
 *
 * @param {File|Blob|{uri,name?,type?}|string|null} photoFile
 * @param {'web'|'ios'|'android'} platformOs
 */
export function normalizePhotoPart(photoFile, platformOs) {
  if (!photoFile) return null;
  if (platformOs === 'web') return photoFile;
  if (typeof photoFile === 'object' && typeof photoFile.uri === 'string' && photoFile.uri) {
    return {
      uri: photoFile.uri,
      name: photoFile.name || photoFile.fileName || 'barrier.jpg',
      type: resolveMimeType(photoFile.uri, photoFile.type),
    };
  }
  return photoFile;
}

/**
 * Build the MongoDB-aligned barrier report document + multipart photo part.
 *
 * Fallback chain for coordinates: manual (map pin) -> EXIF GPS ->
 * deviceLocation/fallbackCoordinates -> DEFAULT_CENTER. Matches the
 * volunteer + admin flows and the backend's flat lat/lng handling.
 *
 * @param {object} input
 * @param {string} input.category - one of REPORT_CATEGORIES
 * @param {number} input.rating - integer 1-5
 * @param {string} [input.notes]
 * @param {string} [input.name]
 * @param {string} [input.locationName]
 * @param {string} [input.condition] - 'good' | 'bad' (default 'bad')
 * @param {number} [input.latitude] - manual/EXIF latitude
 * @param {number} [input.longitude] - manual/EXIF longitude
 * @param {{latitude:number,longitude:number}} [input.fallbackCoordinates] - device location
 * @param {object} [input.exifResult] - { latitude, longitude, altitude, capturedAt }
 * @param {string|Date} [input.capturedAt]
 * @param {string} [input.imageUri] - preview URI (used as photoUrl only when remote)
 * @param {File|Blob|{uri,name?,type?}|string} [input.photoFile]
 * @param {string} [input.reporterId] - raw id, sanitized internally
 * @param {'web'|'ios'|'android'} [input.platformOs='web']
 * @param {(stage:string, meta:object)=>void} [input.logger] - dev diagnostics hook
 * @returns {{ payload: object, photoMeta: object|null, latitude: number, longitude: number }}
 */
export function buildBarrierReportPayload(input = {}) {
  const {
    category,
    rating,
    notes,
    name,
    locationName,
    condition,
    latitude,
    longitude,
    fallbackCoordinates,
    exifResult,
    capturedAt,
    imageUri,
    photoFile,
    reporterId: rawReporterId,
    platformOs = 'web',
    logger,
  } = input;

  // EXIF + fallback merge (same helper the admin modal uses).
  const barrierFields = toBarrierReportFields(
    {
      latitude: exifResult?.latitude ?? latitude,
      longitude: exifResult?.longitude ?? longitude,
      altitude: exifResult?.altitude ?? null,
      capturedAt: exifResult?.capturedAt ?? null,
      hasGps: true,
      hasTimestamp: !!exifResult?.capturedAt,
    },
    fallbackCoordinates
  );

  let finalLat = barrierFields.coordinates.latitude ?? latitude;
  let finalLng = barrierFields.coordinates.longitude ?? longitude;
  if (typeof finalLat !== 'number' || typeof finalLng !== 'number') {
    finalLat = DEFAULT_CENTER.latitude;
    finalLng = DEFAULT_CENTER.longitude;
  }

  const resolvedName = (name && String(name).trim()) || (category ? `${category} Barrier` : 'Barrier Report');
  const resolvedLocationName =
    (locationName && String(locationName).trim()) || `Volunteer Report ${finalLat.toFixed(3)}, ${finalLng.toFixed(3)}`;
  const resolvedCondition = condition || 'bad';
  const resolvedCapturedAt = (() => {
    if (capturedAt) {
      const d = new Date(capturedAt);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    if (barrierFields.capturedAt instanceof Date) return barrierFields.capturedAt.toISOString();
    if (barrierFields.capturedAt) return String(barrierFields.capturedAt);
    return new Date().toISOString();
  })();

  const reporterId = sanitizeReporterId(rawReporterId);

  // Multipart upload wins on the backend — a local URI must never be stored
  // as photoUrl (backend 400s device-local schemes).
  const normalizedPhoto = normalizePhotoPart(photoFile, platformOs);
  const remotePhotoUrl = !normalizedPhoto && typeof imageUri === 'string' && !isDeviceLocalUri(imageUri) ? imageUri : undefined;

  const exifMetadata = {
    latitude: finalLat,
    longitude: finalLng,
    altitude: exifResult?.altitude ?? null,
    timestamp: resolvedCapturedAt,
    capturedAt: resolvedCapturedAt,
  };

  const payload = {
    name: resolvedName,
    locationName: resolvedLocationName,
    category,
    rating,
    condition: resolvedCondition,
    triageStatus: 'pending',
    notes: notes?.trim() || undefined,
    photoUrl: remotePhotoUrl,
    coordinates: { latitude: finalLat, longitude: finalLng },
    location: { type: 'Point', coordinates: [finalLng, finalLat] },
    latitude: finalLat,
    longitude: finalLng,
    exifMetadata,
    capturedAt: resolvedCapturedAt,
    timestamp: resolvedCapturedAt,
    reporterId,
  };
  if (normalizedPhoto) payload.photoUrl = undefined;

  // File objects can't survive storage reload: rebuild a multipart part
  // verbatim from the persisted local URI. No existence pre-checks, no byte
  // reads — readability is proven by attempting the upload tiers themselves.
  let photoMeta = normalizedPhoto;
  if (!photoMeta && typeof imageUri === 'string' && platformOs !== 'web' && isDeviceLocalUri(imageUri)) {
    photoMeta = { uri: imageUri, name: `photo_${Date.now()}.jpg`, type: resolveMimeType(imageUri) };
    try { logger && logger('PHOTO_REBUILT', photoMeta); } catch {}
  }

  return { payload, photoMeta, latitude: finalLat, longitude: finalLng };
}

/**
 * Client-side mirror of reportController.js 400 rules. Fails fast so the UI
 * shows field errors without a network round-trip.
 *
 * @param {object} payload - built by buildBarrierReportPayload()
 * @param {{ hasPhoto: boolean }} [opts]
 * @returns {{ isValid: boolean, errors: Record<string,string> }}
 */
export function validateBarrierReportPayload(payload = {}, opts = {}) {
  const errors = {};
  const hasPhoto = !!opts.hasPhoto || (typeof payload.photoUrl === 'string' && !!payload.photoUrl.trim());

  if (!payload.category || !REPORT_CATEGORIES.includes(payload.category)) {
    errors.category = `Category is required (${REPORT_CATEGORIES.join(', ')}).`;
  }

  if (payload.rating === undefined || payload.rating === null) {
    errors.rating = 'Rating is required (1-5).';
  } else {
    const n = Number(payload.rating);
    if (!Number.isInteger(n) || n < 1 || n > 5) errors.rating = 'Rating must be an integer between 1 and 5.';
  }

  const lat = payload.coordinates?.latitude ?? payload.latitude;
  const lng = payload.coordinates?.longitude ?? payload.longitude;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    errors.coordinates = 'Valid latitude (-90..90) is required.';
  }
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    errors.coordinates = 'Valid longitude (-180..180) is required.';
  }

  if (!hasPhoto) {
    errors.photo = 'Photo is required. Capture a photo before submitting.';
  }

  if (payload.name !== undefined && payload.name !== null && String(payload.name).length > 100) {
    errors.name = 'Name must be at most 100 characters.';
  }
  if (payload.locationName !== undefined && payload.locationName !== null && String(payload.locationName).length > 300) {
    errors.locationName = 'Location name must be at most 300 characters.';
  }
  if (payload.condition !== undefined && payload.condition !== null && !REPORT_CONDITIONS.includes(String(payload.condition).toLowerCase())) {
    errors.condition = 'Condition must be good or bad.';
  }
  if (payload.notes !== undefined && payload.notes !== null) {
    if (typeof payload.notes !== 'string') errors.notes = 'Notes must be a string.';
    else if (payload.notes.length > 1000) errors.notes = 'Notes must be at most 1000 characters.';
  }

  return { isValid: Object.keys(errors).length === 0, errors };
}

export default {
  REPORT_CATEGORIES,
  REPORT_CONDITIONS,
  DEFAULT_CENTER,
  resolveMimeType,
  sanitizeReporterId,
  normalizePhotoPart,
  buildBarrierReportPayload,
  validateBarrierReportPayload,
};
