import AsyncStorage from '@react-native-async-storage/async-storage';

const HIGH_CONTRAST_KEY = '@unitymap/highContrast';
const WHEELCHAIR_ACCESSIBLE_KEY = '@unitymap/wheelchairAccessible';
const RECENT_SEARCHES_KEY = '@unitymap/recentSearches';
const VOLUNTEER_DRAFT_KEY = '@unitymap/volunteerDraft';
const AUDIO_LAUNCHER_KEY = '@unitymap/audioLauncherEnabled';

export const loadHighContrast = async () => {
  try {
    const v = await AsyncStorage.getItem(HIGH_CONTRAST_KEY);
    return v === 'true';
  } catch {
    return false;
  }
};

export const saveHighContrast = async (value) => {
  try {
    await AsyncStorage.setItem(HIGH_CONTRAST_KEY, value ? 'true' : 'false');
  } catch {}
};

export const loadWheelchairAccessible = async () => {
  try {
    const v = await AsyncStorage.getItem(WHEELCHAIR_ACCESSIBLE_KEY);
    return v !== null ? v === 'true' : true;
  } catch {
    return true;
  }
};

export const saveWheelchairAccessible = async (value) => {
  try {
    await AsyncStorage.setItem(WHEELCHAIR_ACCESSIBLE_KEY, value ? 'true' : 'false');
  } catch {}
};

export const loadRecentSearches = async () => {
  try {
    const v = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
    const parsed = v ? JSON.parse(v) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveRecentSearches = async (searches) => {
  try {
    await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches));
  } catch {}
};

/**
 * Volunteer draft shape for SPT-109 3-tap audit form — extended to mirror AdminAddReportModal:
 * { imageUri, exifResult, category, rating, notes, name, condition, locationName, capturedAt, manualCoords, updatedAt }
 * Backward compatible with legacy drafts that only had { imageUri, exifResult, updatedAt }
 */
export const loadVolunteerDraft = async () => {
  try {
    const v = await AsyncStorage.getItem(VOLUNTEER_DRAFT_KEY);
    if (!v) return null;
    const parsed = JSON.parse(v);
    if (!parsed || typeof parsed !== 'object') return null;
    // Normalize for backward compatibility – older drafts lack category/rating/notes and new admin-parity fields
    return {
      imageUri: parsed.imageUri ?? null,
      exifResult: parsed.exifResult ?? null,
      category: parsed.category ?? null,
      rating: parsed.rating ?? null,
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      name: typeof parsed.name === 'string' ? parsed.name : '',
      condition: parsed.condition === 'good' || parsed.condition === 'bad' ? parsed.condition : 'bad',
      locationName: typeof parsed.locationName === 'string' ? parsed.locationName : '',
      capturedAt: parsed.capturedAt ?? null,
      manualCoords: parsed.manualCoords && typeof parsed.manualCoords.latitude === 'number' && typeof parsed.manualCoords.longitude === 'number' ? parsed.manualCoords : null,
      updatedAt: parsed.updatedAt ?? null,
    };
  } catch {
    return null;
  }
};

export const saveVolunteerDraft = async (draft) => {
  try {
    if (!draft || typeof draft !== 'object') return;
    const normalized = {
      imageUri: draft.imageUri ?? null,
      exifResult: draft.exifResult ?? null,
      category: draft.category ?? null,
      rating: draft.rating ?? null,
      notes: typeof draft.notes === 'string' ? draft.notes : '',
      name: typeof draft.name === 'string' ? draft.name : '',
      condition: draft.condition === 'good' || draft.condition === 'bad' ? draft.condition : 'bad',
      locationName: typeof draft.locationName === 'string' ? draft.locationName : '',
      capturedAt: draft.capturedAt ?? null,
      manualCoords: draft.manualCoords && typeof draft.manualCoords.latitude === 'number' && typeof draft.manualCoords.longitude === 'number' ? { latitude: draft.manualCoords.latitude, longitude: draft.manualCoords.longitude } : null,
      updatedAt: draft.updatedAt || new Date().toISOString(),
    };
    // Preserve exifResult sub-shape if already stringified日期; keep as-is
    await AsyncStorage.setItem(VOLUNTEER_DRAFT_KEY, JSON.stringify(normalized));
  } catch {}
};

export const clearVolunteerDraft = async () => {
  try {
    await AsyncStorage.removeItem(VOLUNTEER_DRAFT_KEY);
  } catch {}
};

// --- Offline pending queue: reports cached locally when POST /api/reports fails (offline) ---
// Each entry: { id, payload, photoMeta, imageUri, createdAt, attempts }
// payload is JSON-serializable MongoDB-aligned document (capturedAt/exif timestamps as ISO strings)
const VOLUNTEER_PENDING_QUEUE_KEY = '@unitymap/volunteerPendingQueue';

export const loadPendingReports = async () => {
  try {
    const v = await AsyncStorage.getItem(VOLUNTEER_PENDING_QUEUE_KEY);
    if (!v) return [];
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const savePendingReports = async (queue) => {
  try {
    await AsyncStorage.setItem(VOLUNTEER_PENDING_QUEUE_KEY, JSON.stringify(Array.isArray(queue) ? queue : []));
  } catch {}
};

export const queuePendingReport = async (entry) => {
  try {
    const queue = await loadPendingReports();
    const id = entry?.id || `pending_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const normalized = {
      id,
      payload: entry?.payload ?? null,
      photoMeta: entry?.photoMeta ?? null,
      imageUri: entry?.imageUri ?? null,
      createdAt: entry?.createdAt || new Date().toISOString(),
      attempts: entry?.attempts || 0,
    };
    queue.push(normalized);
    await savePendingReports(queue);
    return id;
  } catch {
    return null;
  }
};

export const removePendingReport = async (id) => {
  try {
    const queue = await loadPendingReports();
    await savePendingReports(queue.filter((e) => e?.id !== id));
  } catch {}
};

export const clearPendingReports = async () => {
  try {
    await AsyncStorage.removeItem(VOLUNTEER_PENDING_QUEUE_KEY);
  } catch {}
};

// Sync queued reports to MongoDB via injected submitter(payload, photoMeta).
// submitter should POST to /api/reports and throw on failure. Returns { synced, remaining }.
export const syncPendingReports = async (submitter) => {
  const queue = await loadPendingReports();
  if (!queue.length || typeof submitter !== 'function') return { synced: 0, remaining: queue.length };
  let synced = 0;
  const remaining = [];
  for (const entry of queue) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await submitter(entry.payload, entry.photoMeta, entry);
      synced += 1;
    } catch {
      remaining.push({ ...entry, attempts: (entry.attempts || 0) + 1 });
    }
  }
  await savePendingReports(remaining);
  return { synced, remaining: remaining.length };
};

export const loadAudioLauncherEnabled = async () => {
  try {
    const v = await AsyncStorage.getItem(AUDIO_LAUNCHER_KEY);
    return v !== null ? v === 'true' : false;
  } catch {
    return false;
  }
};

export const saveAudioLauncherEnabled = async (value) => {
  try {
    await AsyncStorage.setItem(AUDIO_LAUNCHER_KEY, value ? 'true' : 'false');
  } catch {}
};

const PREFERRED_STT_LOCALE_KEY = '@unitymap/preferredSTTLocale';

export const loadPreferredSTTLocale = async () => {
  try {
    const v = await AsyncStorage.getItem(PREFERRED_STT_LOCALE_KEY);
    return v || 'en';
  } catch {
    return 'en';
  }
};

export const savePreferredSTTLocale = async (locale) => {
  try {
    await AsyncStorage.setItem(PREFERRED_STT_LOCALE_KEY, locale);
  } catch {}
};

// SPT-303: Key subset offline cache — English-only, 3 prompts + 3 cues + nodes
const SPEECH_PROMPTS_KEY = '@unitymap/speechPrompts';
const HAZARD_CUES_KEY = '@unitymap/hazardCues';
const NODES_CACHE_KEY = '@unitymap/nodesCache';
const CACHE_VERSION_KEY = '@unitymap/cacheVersion';
const EARCON_MANIFEST_KEY = '@unitymap/earconManifest';

export const loadSpeechPromptsCache = async () => {
  try {
    const v = await AsyncStorage.getItem(SPEECH_PROMPTS_KEY);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
};

export const saveSpeechPromptsCache = async (prompts, version = 1) => {
  try {
    await AsyncStorage.setItem(SPEECH_PROMPTS_KEY, JSON.stringify(prompts));
    await AsyncStorage.setItem(CACHE_VERSION_KEY, String(version));
  } catch {}
};

export const loadHazardCuesCache = async () => {
  try {
    const v = await AsyncStorage.getItem(HAZARD_CUES_KEY);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
};

export const saveHazardCuesCache = async (cues, version = 1) => {
  try {
    await AsyncStorage.setItem(HAZARD_CUES_KEY, JSON.stringify(cues));
    await AsyncStorage.setItem(CACHE_VERSION_KEY, String(version));
  } catch {}
};

export const loadNodesCache = async () => {
  try {
    const v = await AsyncStorage.getItem(NODES_CACHE_KEY);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
};

export const saveNodesCache = async (nodes) => {
  try {
    await AsyncStorage.setItem(NODES_CACHE_KEY, JSON.stringify(nodes));
  } catch {}
};

export const loadEarconManifest = async () => {
  try {
    const v = await AsyncStorage.getItem(EARCON_MANIFEST_KEY);
    return v ? JSON.parse(v) : {};
  } catch {
    return {};
  }
};

export const saveEarconManifest = async (manifest) => {
  try {
    await AsyncStorage.setItem(EARCON_MANIFEST_KEY, JSON.stringify(manifest));
  } catch {}
};

export const loadCacheVersion = async () => {
  try {
    const v = await AsyncStorage.getItem(CACHE_VERSION_KEY);
    return v ? Number(v) : 0;
  } catch {
    return 0;
  }
};

export default {
  loadHighContrast,
  saveHighContrast,
  loadWheelchairAccessible,
  saveWheelchairAccessible,
  loadRecentSearches,
  saveRecentSearches,
  loadVolunteerDraft,
  saveVolunteerDraft,
  clearVolunteerDraft,
  loadPendingReports,
  queuePendingReport,
  removePendingReport,
  clearPendingReports,
  syncPendingReports,
  loadAudioLauncherEnabled,
  saveAudioLauncherEnabled,
  loadPreferredSTTLocale,
  savePreferredSTTLocale,
  loadSpeechPromptsCache,
  saveSpeechPromptsCache,
  loadHazardCuesCache,
  saveHazardCuesCache,
  loadNodesCache,
  saveNodesCache,
  loadEarconManifest,
  saveEarconManifest,
  loadCacheVersion,
};

