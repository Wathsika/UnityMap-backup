import { Platform, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

/**
 * UnityMap Centralized API Service
 * Connects React Native / Web frontend to Node.js / Express backend with MongoDB.
 */

export const PRIMARY_PORT = '5000'; // Matches backend/.env PORT
export const FALLBACK_PORT = '5001';

/**
 * Dynamically resolves the host IP for mobile devices and web browsers.
 * Prefers the host that served the JS bundle itself (guaranteed routable from the
 * device, since the bundle loaded from it), then Metro scriptURL, then an explicit
 * EXPO_PUBLIC_API_HOST override. No hardcoded LAN IPs — they go stale on DHCP change.
 */
export const getHostAddress = () => {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location && window.location.hostname) {
      return window.location.hostname;
    }
    return 'localhost';
  }

  // 1. Explicit override for fixed dev setups (e.g. EXPO_PUBLIC_API_HOST=192.168.1.177)
  try {
    const override = typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_API_HOST : null;
    if (override && typeof override === 'string' && override.trim()) {
      return override.trim();
    }
  } catch (e) {}

  const hostOf = (uri) => {
    if (!uri || typeof uri !== 'string') return null;
    const host = uri.split('://')[1]?.split('/')[0]?.split(':')[0];
    return host && host.trim() ? host.trim() : null;
  };

  // One-time dev diagnostic: prints every host source so a single Metro line reveals
  // why a physical device falls through to the 10.0.2.2 last resort. Silent in release.
  if (!getHostAddress._logged) {
    getHostAddress._logged = true;
    try {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        const scriptURL = NativeModules?.SourceCode?.scriptURL;
        console.log(
          `[net] host sources platform=${Platform.OS} ` +
          `expoConfig.hostUri=${Constants?.expoConfig?.hostUri || 'none'} ` +
          `manifest.debuggerHost=${Constants?.manifest?.debuggerHost || 'none'} ` +
          `scriptURL=${scriptURL || 'none'} ` +
          `override=${typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_HOST ? 'set' : 'unset'} ` +
          `appOwnership=${Constants?.appOwnership || 'unknown'}`
        );
      }
    } catch {}
  }

  // 2. Expo bundle source — same machine that served the app over LAN
  try {
    const hostUri = Constants?.expoConfig?.hostUri || Constants?.manifest?.debuggerHost || Constants?.manifest2?.extra?.expoClient?.hostUri;
    const host = hostOf(hostUri);
    if (host) return host;
  } catch (e) {}

  // 3. React Native dev server host detection via scriptURL
  try {
    const scriptURL = NativeModules?.SourceCode?.scriptURL;
    const host = hostOf(scriptURL);
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return host;
    }
  } catch (e) {}

  // 4. Android emulator loopback to host PC (last resort on device)
  return '10.0.2.2';
};

// Highest priority: full base URL override, e.g.
// EXPO_PUBLIC_API_URL=http://192.168.1.50:5000/api (documented in frontend/.env.example).
// Wins over all auto-detection; the port argument is ignored when set.
export const explicitApiUrl = () => {
  try {
    const u = typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_API_URL : null;
    if (!u || typeof u !== 'string' || !u.trim()) return null;
    const clean = u.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(clean)) return null;
    return /\/api$/i.test(clean) ? clean : `${clean}/api`;
  } catch {}
  return null;
};

// --- Verified-host cache ----------------------------------------------------
// Declared before getBaseUrl(): API_BASE_URL = getBaseUrl() runs at module init,
// so reading these bindings any later would throw a TDZ ReferenceError.
const VERIFIED_HOST_TTL_MS = 2 * 60 * 1000;
let verifiedHost = null; // { host, at }

export const getBaseUrl = (port = PRIMARY_PORT) => {
  const explicit = explicitApiUrl();
  if (explicit) return explicit;
  const host = (verifiedHost && Date.now() - verifiedHost.at < VERIFIED_HOST_TTL_MS)
    ? verifiedHost.host
    : getHostAddress();
  return `http://${host}:${port}/api`;
};

/**
 * Every base URL to try, in order, when the primary port is unreachable.
 * `apiRequest` walks this chain for JSON calls; non-JSON downloads (e.g. the
 * statutory audit PDF) must walk it too, otherwise they hit a dead port while
 * the rest of the dashboard still renders fine.
 */
export const getApiBaseUrlCandidates = () => {
  const candidates = [getBaseUrl(PRIMARY_PORT), getBaseUrl(FALLBACK_PORT)];
  if (Platform.OS !== 'web') {
    candidates.push(`http://10.0.2.2:${PRIMARY_PORT}/api`, `http://localhost:${PRIMARY_PORT}/api`);
  }
  return [...new Set(candidates)];
};

export const API_BASE_URL = getBaseUrl();

/**
 * Invoked when the API rejects our credentials (401). Registered by authService to
 * avoid a circular import between the API client and the session store.
 */
let unauthorizedHandler = null;
export const setUnauthorizedHandler = (fn) => {
  unauthorizedHandler = fn;
};

/**
 * Single error type for every non-2xx response. Carries the server's own
 * validation text (`detail` / `backendError`) so callers can render the exact
 * field error, plus `isHttpError` so the host-fallback chain below can tell a
 * dead host apart from a real HTTP verdict.
 */
export class ApiError extends Error {
  constructor(message, status, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = extra.detail || '';
    this.backendError = extra.backendError || '';
    this.isHttpError = true;
  }
}

/**
 * True when `err` is an abort/cancel rather than a real HTTP verdict.
 * Expo's native fetch (SDK 54+) surfaces our AbortController.abort() as
 * "fetch failed: Fetch request has been canceled"; browsers/RN report AbortError.
 * ApiErrors are never aborts — they carry a server verdict we must preserve.
 */
const isAbortLike = (err) => {
  if (!err || err instanceof ApiError) return false;
  if (err.timedOut === true) return true;
  if (err.name === 'AbortError') return true;
  return /abort|canceled|cancelled/i.test(String(err.message || ''));
};

// --- Verified-host selection -----------------------------------------------
// getHostAddress() can return a stale/unroutable host (DHCP churn, emulator alias
// on physical hardware). warmApiHost() probes candidate hosts with a fast /health
// check and caches the first one that answers. getBaseUrl() prefers the cached
// winner while fresh; the apiRequest fallback chain remains as safety net.
const VERIFIED_HOST_STORE_KEY = '@unitymap/apiHost';
const PROBE_TIMEOUT_MS = 2500;
let warmingPromise = null;

const candidateHosts = () => {
  const hosts = [];
  const push = (h) => {
    if (h && typeof h === 'string' && h.trim() && !hosts.includes(h.trim())) hosts.push(h.trim());
  };
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location?.hostname) push(window.location.hostname);
    push('localhost');
    return hosts;
  }
  try {
    const override = typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_API_HOST : null;
    if (override && typeof override === 'string' && override.trim()) push(override);
  } catch {}
  // Last-known-good first (cold-start speed); validated by probe below, never trusted blindly.
  if (verifiedHost?.host) push(verifiedHost.host);
  try {
    const hostUri = Constants?.expoConfig?.hostUri || Constants?.manifest?.debuggerHost;
    const h = hostUri && hostUri.split('://')[1]?.split('/')[0]?.split(':')[0];
    if (h && h.trim()) push(h);
  } catch {}
  try {
    const scriptURL = NativeModules?.SourceCode?.scriptURL;
    const h = scriptURL && scriptURL.split('://')[1]?.split('/')[0]?.split(':')[0];
    if (h && h.trim() && h !== 'localhost' && h !== '127.0.0.1') push(h);
  } catch {}
  push('10.0.2.2');
  push('localhost');
  return hosts;
};

const probeBase = async (base) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(`${base}/health`, { signal: controller.signal });
    return !!r && r.status > 0 && r.status < 600;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
};

/**
 * Verify backend reachability and cache the winning host. Never throws —
 * returns the working base URL or null (callers fall back to legacy resolution).
 * Safe to call on every submit: instant when the cache is fresh.
 */
export const warmApiHost = async () => {
  if (warmingPromise) return warmingPromise;
  warmingPromise = (async () => {
    try {
      if (verifiedHost && Date.now() - verifiedHost.at < VERIFIED_HOST_TTL_MS) {
        return `http://${verifiedHost.host}:${PRIMARY_PORT}/api`;
      }
      // Explicit full-URL override wins immediately when reachable (no sweep needed).
      const explicit = explicitApiUrl();
      if (explicit) {
        if (await probeBase(explicit)) {
          console.log(`[API] verified host: ${explicit} (EXPO_PUBLIC_API_URL)`);
          return explicit;
        }
        return null;
      }
      // Cold start: seed from persisted last-known-good (validated by probe below).
      if (!verifiedHost) {
        try {
          const stored = await AsyncStorage.getItem(VERIFIED_HOST_STORE_KEY);
          if (stored) verifiedHost = { host: String(stored), at: 0 }; // at=0 forces re-probe, keeps priority
        } catch {}
      }
      const ports = [PRIMARY_PORT, FALLBACK_PORT];
      for (const port of ports) {
        for (const host of candidateHosts()) {
          const base = `http://${host}:${port}/api`;
          if (await probeBase(base)) {
            verifiedHost = { host, at: Date.now() };
            try { await AsyncStorage.setItem(VERIFIED_HOST_STORE_KEY, host); } catch {}
            console.log(`[API] verified host: ${base}`);
            return base;
          }
        }
      }
      return null;
    } finally {
      warmingPromise = null;
    }
  })();
  return warmingPromise;
};

// Coalesces concurrent identical background GETs (re-render / navigation remounts)
// onto one shared promise so map polling can't spawn duplicate request storms.
// POSTs/mutations are never deduped. Entries are removed on settle (no leak).
const inflightGets = new Map();

export const apiRequest = async (endpoint, options = {}) => {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  // Per-call timeout override (ms). Image uploads need far longer than plain GETs:
  // aborting a healthy multipart POST at 20s both fails the submit AND mislabels it
  // as "offline". Background GETs default to 20000ms (≥15000ms requirement).
  // Never forward timeoutMs to fetch itself.
  // noFallback (opt-in): typeahead-style calls fail fast on the primary host
  // instead of walking fallback ports/hosts (~45s of spinner). Never forwarded.
  const { timeoutMs, noFallback, ...fetchOptions } = options;
  const timeout = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 20000;
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const dedupKey = method === 'GET' && typeof fetchOptions.body === 'undefined'
    ? `GET ${cleanEndpoint}`
    : null;
  if (dedupKey && inflightGets.has(dedupKey)) {
    return inflightGets.get(dedupKey);
  }

  // Each request owns an independent AbortController/signal — background polls and
  // the report submission can never cancel each other; only their own timeout aborts them.
  const run = async () => {

  const isFormData = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData;

  // Attach the signed session token to every request so authenticated admin
  // routes are reachable without each caller assembling headers by hand.
  const authHeaders = await getAuthHeaders();

  const defaultHeaders = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    Accept: 'application/json',
    ...authHeaders,
  };

  const tryFetch = async (baseUrl, timeoutOverride) => {
    const url = `${baseUrl}${cleanEndpoint}`;
    const controller = new AbortController();
    const attemptTimeout = typeof timeoutOverride === 'number' && timeoutOverride > 0 ? timeoutOverride : timeout;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, attemptTimeout);

    // One line per attempt in Metro so a hung host is obvious without a packet capture.
    const devLog = (outcome) => {
      try {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.log(`[API] ${method} ${url} → ${outcome}`);
        }
      } catch {}
    };

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers: { ...defaultHeaders, ...fetchOptions.headers },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Surface the backend's own message (e.g. reportController 400s, "Invalid email
        // or password") instead of generic status text, and keep the structured fields
        // so callers can render the exact field error without the wrapper.
        let detail = '';
        let backendError = '';
        try {
          const clone = typeof response.clone === 'function' ? response.clone() : null;
          const errBody = clone ? await clone.json() : null;
          detail = errBody?.message || '';
          backendError = errBody?.error || '';
        } catch (_) {}
        const extra = [detail, backendError && backendError !== detail ? backendError : ''].filter(Boolean).join(' | ');
        const httpErr = new ApiError(
          detail || `API Request Failed: ${response.status} ${response.statusText}${extra ? ` — ${extra}` : ''}`,
          response.status,
          { detail, backendError }
        );

        if (response.status === 401 && unauthorizedHandler) {
          unauthorizedHandler();
        }

        devLog(`HTTP ${response.status}`);
        throw httpErr;
      }

      devLog('ok');
      return await response.json();
    } catch (err) {
      clearTimeout(timeoutId);
      // An abort we triggered is a timeout — rebrand the cryptic native
      // "Fetch request has been canceled" into an actionable ApiError that
      // names the host we actually tried.
      if (timedOut || isAbortLike(err)) {
        const seconds = Math.max(1, Math.round(attemptTimeout / 1000));
        const timeoutErr = new ApiError(
          `Connection timeout (${seconds}s) — no response from ${baseUrl}.`,
          504
        );
        timeoutErr.timedOut = true;
        timeoutErr.baseUrl = baseUrl;
        devLog(`timeout after ${seconds}s`);
        throw timeoutErr;
      }
      devLog(`error: ${err?.message || err}`);
      throw err;
    }
  };

  // Throttle repeated fallback logging per endpoint — background polling (health checks,
  // location-driven nearby fetches) against an unreachable backend would otherwise spam
  // a warning + error toast on every poll cycle. Behavior is unchanged: errors still throw.
  const logKey = `${cleanEndpoint}`;
  const shouldLogWarn = (() => {
    const now = Date.now();
    const last = apiRequest._lastWarnAt?.[logKey] || 0;
    if (now - last < 60000) return false;
    (apiRequest._lastWarnAt = apiRequest._lastWarnAt || {})[logKey] = now;
    return true;
  })();

  // Retry fallback hosts only on true network failures — never on HTTP 4xx validation
  // errors (retrying a 400 against 3 more hosts just multiplies confusing warnings).
  const isRetryableNetworkError = (err) => {
    if (!err) return false;
    if (err.isHttpError) return err.status >= 500 || err.status === 429;
    if (typeof err.status === 'number' && err.status >= 400 && err.status < 500) return false;
    const raw = `${err?.message || ''}`.toLowerCase();
    if (/api request failed:\s*4\d\d\b/.test(raw)) return false;
    return /network|fetch|abort|offline|failed to fetch|econn|etimedout|timeout|unreachable|all connection attempts failed|load failed/.test(raw);
  };

  // Mutations (POST/PUT/PATCH/DELETE) probe candidate hosts first via the fast
  // /health check (2.5s each). A dead host then fails in seconds with a clear
  // message instead of burning the full request timeout per candidate — which
  // previously surfaced to users as "Fetch request has been canceled" after ~56s.
  let primaryBase = getBaseUrl(PRIMARY_PORT);
  if (method !== 'GET') {
    let verified = null;
    try {
      verified = await warmApiHost();
    } catch {}
    if (!verified) {
      const candidates = getApiBaseUrlCandidates();
      const unreachable = new ApiError(
        `All UnityMap backend hosts unreachable (${candidates.join(', ')}). ` +
          'Start the backend (cd backend && npm run dev) and make sure this device is on the same network as the PC.',
        503
      );
      unreachable.unreachable = true;
      if (shouldLogWarn) {
        console.error(`[API Error] ${method} ${cleanEndpoint}: ${unreachable.message}`);
      }
      throw unreachable;
    }
    primaryBase = verified;
  }

  // Try primary configured port
  try {
    return await tryFetch(primaryBase);
  } catch (primaryErr) {
    // Fast-fail callers (typeahead search) never walk the fallback chain —
    // they render local results instead of spinning through dead hosts.
    if (noFallback) throw primaryErr;
    // An auth verdict is port-independent — never replay credentials elsewhere.
    if (primaryErr instanceof ApiError && (primaryErr.status === 401 || primaryErr.status === 403)) {
      throw primaryErr;
    }
    if (!isRetryableNetworkError(primaryErr)) throw primaryErr;
    if (shouldLogWarn) {
      console.warn(
        `[API Warning] Endpoint ${cleanEndpoint} unreachable on port ${PRIMARY_PORT} (${primaryErr.message}). Retrying fallback...`
      );
    }

    // Try fallback port (5001) — same host, full timeout (covers backend port-shift)
    try {
      return await tryFetch(getBaseUrl(FALLBACK_PORT));
    } catch (fallbackErr) {
      // An auth verdict is port-independent — never replay credentials elsewhere.
      if (fallbackErr instanceof ApiError && (fallbackErr.status === 401 || fallbackErr.status === 403)) {
        throw fallbackErr;
      }

      // Speculative emulator hosts get a short timeout and are skipped when they
      // duplicate a URL already attempted — they must fail fast, not hang per host.
      const tried = new Set([primaryBase, getBaseUrl(PRIMARY_PORT), getBaseUrl(FALLBACK_PORT)]);
      const trySpeculative = async (baseUrl) => {
        if (tried.has(baseUrl)) return null;
        tried.add(baseUrl);
        return tryFetch(baseUrl, Math.min(timeout, 8000));
      };
      if (Platform.OS !== 'web') {
        try {
          const r = await trySpeculative(`http://10.0.2.2:${PRIMARY_PORT}/api`);
          if (r) return r;
          const r2 = await trySpeculative(`http://localhost:${PRIMARY_PORT}/api`);
          if (r2) return r2;
        } catch (speculativeErr) {
          // A rejected token must not be replayed against yet another host either.
          if (speculativeErr instanceof ApiError && (speculativeErr.status === 401 || speculativeErr.status === 403)) {
            throw speculativeErr;
          }
        }
      }

      if (shouldLogWarn) {
        console.error(
          `[API Error] All connection attempts failed for ${cleanEndpoint}:`,
          primaryErr.message
        );
      }
      throw primaryErr;
    }
  }
  };

  if (!dedupKey) return run();
  const shared = run();
  inflightGets.set(dedupKey, shared);
  const cleanup = () => { if (inflightGets.get(dedupKey) === shared) inflightGets.delete(dedupKey); };
  shared.then(cleanup, cleanup);
  return shared;
};

// Node & Destination Endpoints
export const getNodes = (floorLevel) => {
  const query = floorLevel !== undefined ? `?floorLevel=${floorLevel}` : '';
  return apiRequest(`/nodes${query}`);
};

export const getNearbyNodes = (lng, lat, maxDistance = 1000) => {
  return apiRequest(`/nodes/nearby?lng=${lng}&lat=${lat}&maxDistance=${maxDistance}`);
};

export const createNode = (nodeData) => {
  return apiRequest('/nodes', {
    method: 'POST',
    body: JSON.stringify(nodeData),
  });
};

// Obstacle & Barrier Endpoints
export const getObstacles = (isActive = true, obstacleType) => {
  const params = new URLSearchParams();
  if (isActive !== undefined) params.append('isActive', String(isActive));
  if (obstacleType) params.append('obstacleType', obstacleType);
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/obstacles${query}`);
};

export const getNearbyObstacles = (lng, lat, maxDistance = 1000) => {
  return apiRequest(`/obstacles/nearby?lng=${lng}&lat=${lat}&maxDistance=${maxDistance}`);
};

/**
 * Snaps a GPS coordinate to the nearest routable DB node.
 * Used by tap-to-route: tap → nearest node → getRoute().
 * Returns the first node in the nearby result, or null.
 */
export const getNearestNode = async (lng, lat, maxDistance = 500) => {
  const res = await apiRequest(`/nodes/nearby?lng=${lng}&lat=${lat}&maxDistance=${maxDistance}`);
  const nodes = res?.data ?? res;
  return Array.isArray(nodes) && nodes.length > 0 ? nodes[0] : null;
};

export const createObstacle = (obstacleData) => {
  return apiRequest('/obstacles', {
    method: 'POST',
    body: JSON.stringify(obstacleData),
  });
};

// Elevators & Pathways
export const getElevators = () => apiRequest('/elevators');
export const getElevatorOverview = () => apiRequest('/elevators/overview');

export const getPathways = (options = {}) => {
  if (typeof options === 'boolean') {
    return apiRequest(`/pathways?wheelchairAccessible=${options}`);
  }
  const params = new URLSearchParams();
  if (options && options.wheelchairAccessible !== undefined) {
    params.append('wheelchairAccessible', String(options.wheelchairAccessible));
  }
  if (options && options.pathType) {
    params.append('pathType', options.pathType);
  }
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/pathways${query}`);
};

/**
 * SPT-102 — Fetch a computed route between two nodes.
 * SPT-106 — Optionally include spoken summary via includeSpeech & locale (en only).
 */
export const getRoute = (originNodeId, destinationNodeId, wheelchairAccessible = false, options = {}) => {
  // Backward compat: wheelchairAccessible may be options object
  let includeSpeech = false;
  let locale = 'en';
  if (typeof wheelchairAccessible === 'object' && wheelchairAccessible !== null) {
    options = wheelchairAccessible;
    wheelchairAccessible = false;
  }
  if (options.includeSpeech) includeSpeech = options.includeSpeech;
  if (options.locale) locale = options.locale;

  const params = new URLSearchParams({
    originNodeId,
    destinationNodeId,
    wheelchairAccessible: String(wheelchairAccessible),
  });
  if (includeSpeech) {
    params.append('includeSpeech', 'true');
    params.append('locale', locale);
  }
  return apiRequest(`/pathways/route?${params.toString()}`);
};

/**
 * Fetches real road and pathway routing geometry and distance along the street network via OSRM.
 * Matches OpenStreetMap road networks and returns road curve coordinates & exact distance.
 */
export const getRoadRoute = async (originLng, originLat, destLng, destLat) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const url = `https://router.project-osrm.org/route/v1/foot/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson`;
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`OSRM HTTP error: ${response.status}`);
    const data = await response.json();
    if (data.code === 'Ok' && Array.isArray(data.routes) && data.routes.length > 0) {
      const primaryRoute = data.routes[0];
      const coords = primaryRoute.geometry?.coordinates?.map(([lng, lat]) => [Number(lat), Number(lng)]) || [];
      return {
        success: true,
        distanceMeters: Number(primaryRoute.distance) || 0,
        durationSeconds: Number(primaryRoute.duration) || 0,
        coordinates: coords,
      };
    }
  } catch (err) {
    console.warn('[API] OSRM road routing error:', err.message);
  }
  return null;
};

export const checkHealth = () => apiRequest('/health');

// Speech & Audio Cue Endpoints (SPT-007 / SPT-104)
export const getSpeechPrompts = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return apiRequest(`/speech/prompts${query ? `?${query}` : ''}`);
};

export const getLauncherPrompt = (locale = 'en') => {
  return apiRequest(`/speech/prompts?triggerType=launcher_prompt&locale=${locale}`);
};

export const getAudioCues = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return apiRequest(`/audio/cues${query ? `?${query}` : ''}`);
};

export const previewSpeech = (body) => {
  return apiRequest('/speech/preview', {
    method: 'POST',
    body: JSON.stringify(body),
  });
};

// ——— Barrier Report Endpoints (Cloudinary photo upload) ———

/**
 * Get barrier reports with optional filters
 */
export const getReports = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return apiRequest(`/reports${query ? `?${query}` : ''}`);
};

export const getReportById = (id) => apiRequest(`/reports/${id}`);

/**
 * Create a barrier report — photo is uploaded to Cloudinary via backend.
 *
 * @param {object} reportData - { name, locationName, coordinates:{latitude,longitude}, category, rating(1-5 kept), condition:'good'|'bad', notes/note, exifMetadata, capturedAt/timestamp, reporterId }
 * @param {File|Blob|{uri:string, name?:string, type?:string}} [photoFile] - image file to upload (field `photo`)
 * If photoFile is provided, request is sent as multipart/form-data; photoUrl is ignored (server uploads to Cloudinary).
 * If no photoFile, photoUrl must be inside reportData.
 */
export const createReport = async (reportData, photoFile) => {
  // If no file, fallback to JSON (backward compat) - ensure flat lat/lng + new fields are stringified for backend aliases
  if (!photoFile) {
    return apiRequest('/reports', {
      method: 'POST',
      body: JSON.stringify(reportData),
    });
  }

  const formData = new FormData();

  // Strict multipart shaping per platform — never append a plain object on Web
  // (web FormData only accepts string/Blob/File; a {uri,name,type} object throws
  // "Unsupported FormDataPart implementation"). Native (Expo Go) requires the
  // { uri, name, type } shape; File/Blob on native throws the same error.
  const toPhotoPart = async (photo) => {
    const fileNameOf = (p, fallback) => p?.fileName || p?.name || fallback;
    const typeOf = (p) => p?.type || 'image/jpeg';
    if (Platform.OS === 'web') {
      if (typeof File !== 'undefined' && (photo instanceof File || photo instanceof Blob)) {
        const file = photo instanceof File ? photo : new File([photo], `photo_${Date.now()}.jpg`, { type: photo.type || 'image/jpeg' });
        return { kind: 'file', file, fileName: file.name };
      }
      const uri = typeof photo === 'string' ? photo : photo?.uri;
      if (typeof uri === 'string' && uri) {
        // Convert blob:/data:/file: URIs into a real File before appending.
        // A fetch failure here means the image bytes are unreadable (e.g. stale
        // blob URL after reload) — surface as a photo error, NOT a network error,
        // so the caller shows "retake" instead of wrongly queueing offline.
        let blob;
        try {
          const resp = await fetch(uri);
          blob = await resp.blob();
        } catch {
          throw new Error('Could not read selected image — please retake or pick another image.');
        }
        const name = typeof photo === 'object' ? fileNameOf(photo, `photo_${Date.now()}.jpg`) : `photo_${Date.now()}.jpg`;
        const file = new File([blob], name, { type: blob.type || typeOf(photo) });
        return { kind: 'file', file, fileName: name };
      }
      throw new Error('Could not read selected image — please retake or pick another image.');
    }
    // Native (iOS/Android / Expo Go): MUST be { uri, name, type }
    if (photo && typeof photo === 'object' && typeof photo.uri === 'string' && photo.uri) {
      return {
        kind: 'uri-part',
        part: { uri: photo.uri, name: fileNameOf(photo, 'barrier.jpg'), type: typeOf(photo) },
      };
    }
    if (typeof photo === 'string' && photo) {
      return { kind: 'uri-part', part: { uri: photo, name: 'barrier.jpg', type: 'image/jpeg' } };
    }
    const partErr = new Error('Invalid photo attachment — please retake or pick another image.');
    partErr.code = 'PHOTO_PART';
    throw partErr;
  };

  const photoPart = await toPhotoPart(photoFile);
  // Guard the native append itself: if the RN runtime rejects the part, tag the stage
  // (PHOTO_APPEND) instead of surfacing an anonymous native error.
  try {
    if (photoPart.kind === 'file') {
      formData.append('photo', photoPart.file, photoPart.fileName);
    } else {
      formData.append('photo', photoPart.part);
    }
  } catch (appendErr) {
    const err = new Error(`Photo append failed (${appendErr?.message || 'native FormData rejected the part'}) — please retake or pick another image.`);
    err.code = 'PHOTO_APPEND';
    err.cause = appendErr;
    throw err;
  }

  // Append text fields ensuring all are stringified (FormData only supports string/blob)
  const appendString = (key, value) => {
    if (value === undefined || value === null || value === '') return;
    formData.append(key, String(value));
  };
  const appendJson = (key, value) => {
    if (value === undefined || value === null) return;
    if (value instanceof Date) formData.append(key, value.toISOString());
    else if (typeof value === 'object') formData.append(key, JSON.stringify(value));
    else formData.append(key, String(value));
  };

  // Required model fields - always stringified, never raw numbers/objects
  const category = reportData.category;
  const ratingStr = reportData.rating !== undefined && reportData.rating !== null ? String(reportData.rating) : undefined;
  const lat = reportData.coordinates?.latitude ?? reportData.latitude ?? reportData.lat;
  const lng = reportData.coordinates?.longitude ?? reportData.longitude ?? reportData.lng ?? reportData.lon;
  const capturedIso = (() => {
    try {
      const raw = reportData.capturedAt ?? reportData.timestamp ?? reportData.photoTakenAt;
      if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString();
      if (typeof raw === 'string' && raw) {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
      }
    } catch {}
    return new Date().toISOString();
  })();

  appendString('name', reportData.name || (category ? `${category} Barrier` : `Barrier Report`));
  // locationName must be a string — never coerce the GeoJSON `location` object (would send "[object Object]")
  appendString('locationName', typeof reportData.locationName === 'string' && reportData.locationName ? reportData.locationName : 'Assigned Jurisdiction');
  appendString('condition', reportData.condition || 'bad');
  appendString('category', category);
  appendString('rating', ratingStr);
  appendString('notes', reportData.notes ?? reportData.note ?? '');
  // Flat lat/lng as strings for backend robust handling (parseFloat)
  if (lat !== undefined && lat !== null) appendString('latitude', String(lat));
  if (lng !== undefined && lng !== null) appendString('longitude', String(lng));
  appendString('capturedAt', capturedIso);
  // Also append structured fields as JSON for backend parseJsonField
  appendJson('coordinates', reportData.coordinates || (lat !== undefined && lng !== undefined ? { latitude: Number(lat), longitude: Number(lng) } : undefined));
  appendJson('exifMetadata', reportData.exifMetadata);
  // Optional relations
  if (reportData.reporterId) appendString('reporterId', String(reportData.reporterId));
  if (reportData.reporterName) appendString('reporterName', String(reportData.reporterName));
  if (reportData.photoUrl) appendString('photoUrl', String(reportData.photoUrl));

  // 60s: multipart image POSTs include server-side Cloudinary upload time — aborting
  // at the default 20s would kill healthy uploads and mislabel them as "offline".
  return apiRequest('/reports', {
    method: 'POST',
    body: formData,
    timeoutMs: 60000,
  });
};

/**
 * Simple JSON barrier report submission (Prompt 2 spec).
 */
export const createBarrierReport = (reportData) =>
  apiRequest('/reports', {
    method: 'POST',
    body: JSON.stringify(reportData),
    timeoutMs: 30000,
  });

export const getAuthHeaders = async () => {
  try {
    const stored = await AsyncStorage.getItem('@unitymap_session');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.token) {
        return { Authorization: `Bearer ${parsed.token}` };
      }
    }
  } catch (_) {}
  return {};
};

export const corroborateReport = async (reportId) => {
  const authHeaders = await getAuthHeaders();
  return apiRequest(`/reports/${reportId}/corroborate`, { method: 'POST', headers: authHeaders });
};

export const uncorroborateReport = async (reportId) => {
  const authHeaders = await getAuthHeaders();
  return apiRequest(`/reports/${reportId}/corroborate`, { method: 'DELETE', headers: authHeaders });
};

export default {
  API_BASE_URL,
  getBaseUrl,
  getApiBaseUrlCandidates,
  getHostAddress,
  getAuthHeaders,
  setUnauthorizedHandler,
  ApiError,
  explicitApiUrl,
  warmApiHost,
  apiRequest,
  getNodes,
  getNearbyNodes,
  getNearestNode,
  createNode,
  getObstacles,
  getNearbyObstacles,
  createObstacle,
  getElevators,
  getElevatorOverview,
  getPathways,
  getRoute,
  getRoadRoute,
  checkHealth,
  getSpeechPrompts,
  getLauncherPrompt,
  getAudioCues,
  previewSpeech,
  getReports,
  getReportById,
  createReport,
  createBarrierReport,
  corroborateReport,
  uncorroborateReport,
};
