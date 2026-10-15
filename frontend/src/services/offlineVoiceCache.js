import * as FileSystem from 'expo-file-system/legacy';
import { getSpeechPrompts, getAudioCues, getNodes, getBaseUrl } from './api';
import {
  saveSpeechPromptsCache,
  saveHazardCuesCache,
  saveNodesCache,
  loadEarconManifest,
  saveEarconManifest,
} from '../theme/storage';

// Key subset only: 3 prompts (launcher, route_summary, barrier_ahead) + 3 cues (tactile, construction, ramp) — English-only
const PROMPT_FILTER = { triggerType: 'launcher_prompt,route_summary,barrier_ahead', locale: 'en', isActive: true };
const CUE_FILTER = { isActive: true, limit: 3 };

const EARCON_DIR = FileSystem.cacheDirectory + 'earcons/';

const ensureDir = async () => {
  try {
    const info = await FileSystem.getInfoAsync(EARCON_DIR);
    if (!info.exists) await FileSystem.makeDirectoryAsync(EARCON_DIR, { intermediates: true });
  } catch (_) {}
};

/**
 * Download earcon MP3s via expo-file-system and store manifest for offline playback via expo-av
 */
const cacheEarcons = async (cues) => {
  await ensureDir();
  const manifest = await loadEarconManifest();
  const nextManifest = { ...manifest };

  for (const cue of cues.slice(0, 3)) {
    const remoteUrl = cue.earconUrl;
    if (!remoteUrl) continue;
    // Resolve full URL — backend may return relative path
    const fullUrl = remoteUrl.startsWith('http') ? remoteUrl : `${getBaseUrl().replace(/\/api$/, '')}${remoteUrl}`;
    const fileName = remoteUrl.split('/').pop() || `${cue.cueCode}.mp3`;
    const localUri = EARCON_DIR + fileName;

    try {
      const info = await FileSystem.getInfoAsync(localUri);
      if (info.exists && info.size > 1000) {
        nextManifest[cue.cueCode] = { localUri, remoteUrl, size: info.size };
        continue;
      }
      const downloaded = await FileSystem.downloadAsync(fullUrl, localUri);
      if (downloaded.status === 200) {
        const dlInfo = await FileSystem.getInfoAsync(localUri);
        nextManifest[cue.cueCode] = { localUri, remoteUrl, size: dlInfo.size || 0 };
      }
    } catch (e) {
      if (__DEV__) console.warn('[offlineVoiceCache] earcon download failed', cue.cueCode, e?.message);
    }
  }

  await saveEarconManifest(nextManifest);
  return nextManifest;
};

/**
 * Warm cache: fetch key subset from backend and store locally
 * Returns { prompts, cues, nodes, earconManifest }
 */
export const warmCache = async () => {
  try {
    // Speech prompts: use bulk fetch filtered to English subset
    let prompts = [];
    try {
      const res = await getSpeechPrompts({ locale: 'en', isActive: true });
      const all = res?.prompts || res?.data || res || [];
      // Filter to key subset
      const allowed = ['launcher_prompt', 'route_summary', 'barrier_ahead'];
      prompts = Array.isArray(all) ? all.filter((p) => allowed.includes(p.triggerType)).slice(0, 3) : [];
      if (prompts.length === 0 && Array.isArray(all)) prompts = all.slice(0, 3);
      await saveSpeechPromptsCache(prompts, 1);
    } catch (e) {
      if (__DEV__) console.warn('[offlineVoiceCache] prompts fetch failed', e?.message);
    }

    let cues = [];
    try {
      const res = await getAudioCues({ isActive: true });
      const all = res?.cues || res?.data || res || [];
      cues = Array.isArray(all) ? all.slice(0, 3) : [];
      await saveHazardCuesCache(cues, 1);
    } catch (e) {
      if (__DEV__) console.warn('[offlineVoiceCache] cues fetch failed', e?.message);
    }

    let nodes = [];
    try {
      const res = await getNodes();
      const all = res?.data || res || [];
      nodes = Array.isArray(all) ? all.slice(0, 100) : [];
      await saveNodesCache(nodes);
    } catch (e) {
      if (__DEV__) console.warn('[offlineVoiceCache] nodes fetch failed', e?.message);
    }

    const earconManifest = await cacheEarcons(cues);

    return { prompts, cues, nodes, earconManifest };
  } catch (e) {
    if (__DEV__) console.warn('[offlineVoiceCache] warmCache error', e?.message);
    return null;
  }
};

export const getCachedEarconUri = async (cueCode) => {
  const manifest = await loadEarconManifest();
  return manifest[cueCode]?.localUri || null;
};

export default { warmCache, getCachedEarconUri };
