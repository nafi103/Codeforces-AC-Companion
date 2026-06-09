/**
 * CF AC Companion - Background Service Worker
 * Cross-browser: uses B as alias for browser (Firefox/Zen) or chrome.
 */
const B = typeof browser !== 'undefined' ? browser : chrome;
const API_BASE = 'https://codeforces.com/api';

let globalCache = null;
let globalTagsCache = null;
let lastFetchTime = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000;
const CACHE_MISS_COOLDOWN = 5 * 60 * 1000;
let activeFetchPromise = null;

async function loadCacheFromStorage() {
  try {
    const stored = await B.storage.local.get(['cfe_ratings_cache', 'cfe_cache_time']);
    if (!stored.cfe_ratings_cache || !stored.cfe_cache_time) return false;
    const age = Date.now() - stored.cfe_cache_time;
    if (age >= CACHE_TTL) return false;
    globalCache = stored.cfe_ratings_cache;
    lastFetchTime = stored.cfe_cache_time;
    // Load tags cache alongside ratings
    const tagsStored = await B.storage.local.get(['cfe_tags_cache']);
    if (tagsStored.cfe_tags_cache) globalTagsCache = tagsStored.cfe_tags_cache;
    return true;
  } catch (e) { return false; }
}

async function ensureCacheLoaded() {
  if (globalCache && (Date.now() - lastFetchTime < CACHE_TTL)) return true;
  if (await loadCacheFromStorage()) return true;
  if (!activeFetchPromise) {
    activeFetchPromise = refreshProblemCache().finally(() => { activeFetchPromise = null; });
  }
  return activeFetchPromise;
}

async function refreshProblemCache() {
  try {
    const response = await fetch(`${API_BASE}/problemset.problems`);
    const data = await response.json();
    if (data.status === 'OK') {
      globalCache = {};
      globalTagsCache = {};
      for (const p of data.result.problems) {
        const key = `${p.contestId}_${p.index}`;
        if (p.rating !== undefined) globalCache[key] = p.rating;
        if (Array.isArray(p.tags)) globalTagsCache[key] = p.tags;
      }
      lastFetchTime = Date.now();
      await B.storage.local.set({
        cfe_ratings_cache: globalCache,
        cfe_tags_cache: globalTagsCache,
        cfe_cache_time: lastFetchTime
      });
      return true;
    }
  } catch (e) { console.error('[CFE BG] Cache refresh failed:', e); }
  return false;
}

function getRatingFromGlobalCache(contestId, problemIndex) {
  if (!globalCache) return null;
  const r = globalCache[`${contestId}_${problemIndex}`];
  return Number.isInteger(r) ? r : null;
}

B.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    switch (request.action) {
      case 'getRating': {
        const { contestId, problemIndex } = request;
        await ensureCacheLoaded();
        let rating = getRatingFromGlobalCache(contestId, problemIndex);
        if (rating === null && (Date.now() - lastFetchTime > CACHE_MISS_COOLDOWN)) {
          await refreshProblemCache();
          rating = getRatingFromGlobalCache(contestId, problemIndex);
        }
        sendResponse({ rating });
        break;
      }
      case 'getBatchRatings': {
        const results = [];
        await ensureCacheLoaded();
        for (const { contestId, problemIndex } of request.problems) {
          results.push({ contestId, problemIndex, rating: getRatingFromGlobalCache(contestId, problemIndex) });
        }
        sendResponse({ results });
        break;
      }
      case 'refreshCache': {
        const success = await refreshProblemCache();
        if (success) {
          try { await B.alarms.clear('cacheRefresh'); B.alarms.create('cacheRefresh', { periodInMinutes: 1440 }); } catch (_) {}
        }
        sendResponse({ success, count: globalCache ? Object.keys(globalCache).length : 0 });
        break;
      }
      case 'clearCache': {
        globalCache = null; globalTagsCache = null; lastFetchTime = 0; activeFetchPromise = null;
        await B.storage.local.remove(['cfe_ratings_cache', 'cfe_tags_cache', 'cfe_cache_time']);
        try { await B.alarms.clear('cacheRefresh'); B.alarms.create('cacheRefresh', { periodInMinutes: 1440 }); } catch (_) {}
        sendResponse({ success: true });
        break;
      }
      case 'getCacheStats': {
        if (!globalCache) await loadCacheFromStorage();
        sendResponse({ count: globalCache ? Object.keys(globalCache).length : 0, lastFetch: lastFetchTime, age: Date.now() - lastFetchTime });
        break;
      }
      case 'fetchUserRating': {
        try {
          const resp = await fetch(`${API_BASE}/user.info?handles=${encodeURIComponent(request.handle)}`);
          const d = await resp.json();
          if (d.status === 'OK' && d.result.length > 0) {
            sendResponse({ rating: d.result[0].rating, maxRating: d.result[0].maxRating, rank: d.result[0].rank });
          } else { sendResponse({ error: 'User not found' }); }
        } catch (e) { sendResponse({ error: e.message }); }
        break;
      }
      case 'getTags': {
        const { contestId: cId, problemIndex: pIdx } = request;
        await ensureCacheLoaded();
        const key = `${cId}_${pIdx}`;
        const tags = (globalTagsCache && globalTagsCache[key]) ? globalTagsCache[key] : [];
        sendResponse({ tags });
        break;
      }
      default: sendResponse({ error: 'Unknown action' });
    }
  })();
  return true;
});

try {
  if (B.alarms?.create && B.alarms?.onAlarm) {
    B.alarms.create('cacheRefresh', { periodInMinutes: 1440 });
    B.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'cacheRefresh') refreshProblemCache(); });
  }
} catch (_) {}

B.runtime.onInstalled.addListener(() => {
  refreshProblemCache();
  B.storage.sync.set({ userRating: null, hideTagsAutomatically: true, enableGymIntegration: true, enableProblemsetRatings: true });
});

ensureCacheLoaded();
