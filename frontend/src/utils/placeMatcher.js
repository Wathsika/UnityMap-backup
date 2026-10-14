/**
 * placeMatcher.js — shared fuzzy matching for place names (voice + typed search).
 * Pure JS, no React Native imports (smoke-testable under plain node).
 *
 * Replaces the triplicated 3/2/1 substring scorer in UnityMapScreen
 * (handleSearchSubmit / handleLauncherNavigate / handleVoiceConfirm).
 */

/**
 * Common speech-to-text mishear fixes for Sri Lanka place names.
 * Applied to the query before scoring (candidate side is matched via aliases
 * in rankPlaces, so entries here only need to cover frequent STT mistakes).
 */
export const STT_MISHEAR_ALIASES = [
  { from: 'gala face', to: 'galle face' },
  { from: 'gala', to: 'galle' },
  { from: 'gol', to: 'galle' },
  { from: 'petra', to: 'pettah' },
  { from: 'peter market', to: 'pettah market' },
  { from: 'cinnamon garden', to: 'cinnamon gardens' },
  { from: 'dehiwala mount lavinia', to: 'dehiwala-mount lavinia' },
  { from: 'kotahena', to: 'kotthenna' },
  { from: 'narahenpita', to: 'narahenpitiya' },
  { from: 'maharagama', to: 'maharagama' },
  { from: 'kaduwela', to: 'kaduwela' },
  { from: 'thimbirigasyaya', to: 'thimbirigasyaya' },
  { from: 'colombo central', to: 'colombo fort' },
  { from: 'fort railway', to: 'colombo fort railway station' },
  { from: 'bandaranaike airport', to: 'bandaranaike international airport' },
  { from: 'katunayake airport', to: 'bandaranaike international airport' },
  { from: 'negombo fish market', to: 'negombo fish market' },
];

/** Lowercase, strip diacritics, punctuation; collapse whitespace. */
export const normalizePlace = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’"“”.,/\\()\-_:;!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Apply STT mishear aliases to an already-normalized string. */
export const applyMishearAliases = (normalized) => {
  let out = normalized;
  for (const { from, to } of STT_MISHEAR_ALIASES) {
    if (out.includes(from)) out = out.replace(from, to);
  }
  return out;
};

/** Normalized Levenshtein similarity in [0,1] (1 = identical). */
export const levenshteinSimilarity = (a, b) => {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return 1 - prev[n] / Math.max(m, n);
};

/** Bigram (trigram-ish) Dice coefficient in [0,1]. */
export const diceSimilarity = (a, b) => {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s) => {
    const set = new Map();
    for (let i = 0; i < s.length - 1; i += 1) {
      const g = s.slice(i, i + 2);
      set.set(g, (set.get(g) || 0) + 1);
    }
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  let overlap = 0;
  for (const [g, count] of ga) {
    const other = gb.get(g);
    if (other) overlap += Math.min(count, other);
  }
  const totalA = a.length - 1;
  const totalB = b.length - 1;
  return (2 * overlap) / (totalA + totalB);
};

/** Similarity of one query token against one candidate token in [0,1]. */
const tokenSimilarity = (t, u) => {
  if (t === u) return 1;
  if (u.startsWith(t) || t.startsWith(u)) {
    return 0.82 + 0.15 * (Math.min(t.length, u.length) / Math.max(t.length, u.length));
  }
  return Math.max(levenshteinSimilarity(t, u), diceSimilarity(t, u));
};

/** Per-token best-alignment average in [0,1] — tolerates per-word STT errors. */
const tokenAlignedSimilarity = (q, c) => {
  const qTokens = q.split(' ').filter((t) => t.length >= 2);
  const cTokens = c.split(' ').filter((t) => t.length >= 2);
  if (!qTokens.length || !cTokens.length) return 0;
  let sum = 0;
  for (const t of qTokens) {
    let bestTok = 0;
    for (const u of cTokens) {
      const s = tokenSimilarity(t, u);
      if (s > bestTok) bestTok = s;
    }
    sum += bestTok;
  }
  return sum / qTokens.length;
};

/**
 * Similarity of one query against one candidate string in [0,1].
 * Weights: exact 1.0; contains/prefix strong; else blend of whole-string
 * Levenshtein+Dice with per-token best alignment.
 */
export const placeSimilarity = (rawQuery, rawCandidate) => {
  const q = applyMishearAliases(normalizePlace(rawQuery));
  const c = normalizePlace(rawCandidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (c.startsWith(q) || q.startsWith(c)) {
    const shorter = Math.min(q.length, c.length);
    const longer = Math.max(q.length, c.length);
    return 0.82 + 0.15 * (shorter / longer);
  }
  if (c.includes(q) || q.includes(c)) {
    const shorter = Math.min(q.length, c.length);
    const longer = Math.max(q.length, c.length);
    return 0.65 + 0.2 * (shorter / longer);
  }
  const qTokens = q.split(' ').filter((t) => t.length >= 2);
  const cTokens = new Set(c.split(' ').filter((t) => t.length >= 2));
  const tokenHits = qTokens.filter((t) => cTokens.has(t)).length;
  const tokenScore = qTokens.length ? (tokenHits / qTokens.length) * 0.7 : 0;
  const whole = 0.55 * levenshteinSimilarity(q, c) + 0.45 * diceSimilarity(q, c);
  const aligned = tokenAlignedSimilarity(q, c);
  return Math.min(0.95, Math.max(tokenScore, 0.5 * whole + 0.5 * aligned));
};

/**
 * Score one place object against a query.
 * Matches title, plus optional aliases/city/desc fields when present.
 */
export const scorePlace = (query, place) => {
  if (!place) return 0;
  const fields = [place.title, place.name, place.city, ...(place.aliases || [])]
    .filter(Boolean)
    .map((f) => String(f));
  if (!fields.length) return 0;
  let best = 0;
  for (const field of fields) {
    const s = placeSimilarity(query, field);
    if (s > best) best = s;
  }
  // Prefer local/saved rows slightly on ties (they are the campus truth),
  // but never inflate a near-exact score across the 0.98 "exact" threshold.
  if (best > 0 && best < 1 && (place.source === 'local' || place.type === 'node')) {
    best = Math.min(0.97, best + 0.03);
  }
  return best;
};

/**
 * Rank candidate places for a query (descending score).
 * @param {string} query - spoken or typed text (any STT aliases applied inside)
 * @param {Array<object>} places - candidates with title/name (+ optional aliases/city)
 * @param {{minScore?:number}} [opts]
 * @returns {Array<object>} copies with `matchScore` added, sorted best-first
 */
export const rankPlaces = (query, places, opts = {}) => {
  const minScore = typeof opts.minScore === 'number' ? opts.minScore : 0.35;
  const seen = new Set();
  const ranked = [];
  for (const place of Array.isArray(places) ? places : []) {
    if (!place) continue;
    const key = place.placeId || place.id || `${place.title}|${place.lat}|${place.lng}`;
    if (seen.has(key)) continue;
    const matchScore = scorePlace(query, place);
    if (matchScore < minScore) continue;
    seen.add(key);
    ranked.push({ ...place, matchScore });
  }
  ranked.sort((a, b) => {
    const byScore = (b.matchScore || 0) - (a.matchScore || 0);
    if (Math.abs(byScore) > 0.001) return byScore;
    return (b.importance || 0) - (a.importance || 0);
  });
  return ranked;
};

/**
 * Rank candidates against several transcript hypotheses at once (the primary
 * STT transcript plus its alternatives). Each candidate keeps its BEST score
 * across all hypotheses.
 * @param {string[]} texts - transcript hypotheses
 * @param {Array<object>} places - candidates
 * @param {{minScore?:number}} [opts]
 */
export const rankPlacesForTranscripts = (texts, places, opts = {}) => {
  const minScore = typeof opts.minScore === 'number' ? opts.minScore : 0.35;
  const list = Array.isArray(texts) ? texts.filter((t) => String(t || '').trim()) : [];
  if (!list.length) return [];
  const bestByKey = new Map();
  for (const text of list) {
    for (const place of rankPlaces(text, places, { minScore: 0 })) {
      const key = place.placeId || place.id || `${place.title}|${place.lat}|${place.lng}`;
      const prev = bestByKey.get(key);
      if (!prev || (place.matchScore || 0) > (prev.matchScore || 0)) bestByKey.set(key, place);
    }
  }
  return [...bestByKey.values()]
    .filter((p) => (p.matchScore || 0) >= minScore)
    .sort((a, b) => {
      const byScore = (b.matchScore || 0) - (a.matchScore || 0);
      if (Math.abs(byScore) > 0.001) return byScore;
      return (b.importance || 0) - (a.importance || 0);
    });
};

/**
 * Decide whether the top match is confident enough to skip disambiguation.
 * Confident when: strong score AND clear margin over the runner-up (or no runner-up).
 * @param {Array<object>} ranked - output of rankPlaces (best-first)
 * @param {{minScore?:number, minMargin?:number}} [opts]
 * @returns {{best:object|null, alternatives:Array<object>, needsConfirmation:boolean}}
 */
export const chooseBestMatch = (ranked, opts = {}) => {
  const minScore = typeof opts.minScore === 'number' ? opts.minScore : 0.82;
  const minMargin = typeof opts.minMargin === 'number' ? opts.minMargin : 0.15;
  const list = Array.isArray(ranked) ? ranked : [];
  if (!list.length) return { best: null, alternatives: [], needsConfirmation: false };
  const best = list[0];
  const runnerUp = list[1] || null;
  const margin = runnerUp ? (best.matchScore || 0) - (runnerUp.matchScore || 0) : 1;
  // An exact title hit (≥0.98) is confident regardless of runner-up margin.
  const exact = (best.matchScore || 0) >= 0.98;
  const confident = exact || ((best.matchScore || 0) >= minScore && (!runnerUp || margin >= minMargin));
  return {
    best,
    alternatives: list,
    needsConfirmation: !confident && list.length > 1,
  };
};

export default {
  normalizePlace,
  applyMishearAliases,
  placeSimilarity,
  scorePlace,
  rankPlaces,
  rankPlacesForTranscripts,
  chooseBestMatch,
  STT_MISHEAR_ALIASES,
};
