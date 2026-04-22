/**
 * CF AC Companion - Background Service Worker
 * Handles: shared rating caching, cross-origin requests, periodic cache updates
 */

const API_BASE = 'https://codeforces.com/api';

/**
 * Global in-memory cache for problem ratings
 * This is the shared source of truth for page scripts and the popup
 */
let globalCache = null;
let lastFetchTime = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_MISS_COOLDOWN = 5 * 60 * 1000; // 5 minutes - prevent spam on unrated problems
let activeFetchPromise = null;

async function loadCacheFromStorage() {
  try {
    const stored = await chrome.storage.local.get(['cfe_ratings_cache', 'cfe_cache_time']);
    if (!stored.cfe_ratings_cache || !stored.cfe_cache_time) {
      return false;
    }

    const age = Date.now() - stored.cfe_cache_time;
    if (age >= CACHE_TTL) {
      return false;
    }

    globalCache = stored.cfe_ratings_cache;
    lastFetchTime = stored.cfe_cache_time;
    console.log('[CFE Background] Cache loaded from storage');
    return true;
  } catch (error) {
    console.warn('[CFE Background] Could not load cache from storage:', error);
    return false;
  }
}

async function ensureCacheLoaded() {
  if (globalCache && (Date.now() - lastFetchTime < CACHE_TTL)) {
    return true;
  }

  const loaded = await loadCacheFromStorage();
  if (loaded) {
    return true;
  }

  if (!activeFetchPromise) {
    activeFetchPromise = refreshProblemCache().finally(() => {
      activeFetchPromise = null;
    });
  }

  return activeFetchPromise;
}

/**
 * Fetch all problemset problems and cache them
 */
async function refreshProblemCache() {
  try {
    console.log('[CFE Background] Refreshing problem cache...');
    const response = await fetch(`${API_BASE}/problemset.problems`);
    const data = await response.json();

    if (data.status === 'OK') {
      globalCache = {};
      for (const problem of data.result.problems) {
        if (problem.rating !== undefined) {
          const key = `${problem.contestId}_${problem.index}`;
          globalCache[key] = problem.rating;
        }
      }
      lastFetchTime = Date.now();
      await chrome.storage.local.set({
        cfe_ratings_cache: globalCache,
        cfe_cache_time: lastFetchTime
      });
      console.log(`[CFE Background] Cached ${Object.keys(globalCache).length} problems`);
      return true;
    }
  } catch (e) {
    console.error('[CFE Background] Failed to refresh cache:', e);
  }
  return false;
}

/**
 * Get rating from global cache
 */
function getRatingFromGlobalCache(contestId, problemIndex) {
  if (!globalCache) return null;
  const key = `${contestId}_${problemIndex}`;
  const rating = globalCache[key];
  return Number.isInteger(rating) ? rating : null;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    switch (request.action) {
      case 'getRating': {
        const { contestId, problemIndex } = request;

        await ensureCacheLoaded();

        // Check global cache first
        let rating = getRatingFromGlobalCache(contestId, problemIndex);

        if (rating === null && (Date.now() - lastFetchTime > CACHE_MISS_COOLDOWN)) {
          // Only refresh on cache miss if cooldown has elapsed
          // This prevents spam on unrated problems
          await refreshProblemCache();
          rating = getRatingFromGlobalCache(contestId, problemIndex);
        }

        sendResponse({ rating });
        break;
      }

      case 'getBatchRatings': {
        const { problems } = request;
        const results = [];

        // Ensure cache is populated
        await ensureCacheLoaded();

        for (const { contestId, problemIndex } of problems) {
          const rating = getRatingFromGlobalCache(contestId, problemIndex);
          results.push({ contestId, problemIndex, rating });
        }

        sendResponse({ results });
        break;
      }

      case 'refreshCache': {
        const success = await refreshProblemCache();
        
        // Reset alarm to restart the 24-hour countdown from manual refresh
        if (success) {
          try {
            await chrome.alarms.clear('cacheRefresh');
            if (chrome.alarms?.create) {
              chrome.alarms.create('cacheRefresh', {
                periodInMinutes: 1440 // Restart 24-hour timer
              });
            }
          } catch (e) {
            console.warn('[CFE Background] Could not reset alarm:', e);
          }
        }
        
        sendResponse({ success, count: globalCache ? Object.keys(globalCache).length : 0 });
        break;
      }

      case 'clearCache': {
        globalCache = null;
        lastFetchTime = 0;
        activeFetchPromise = null;
        await chrome.storage.local.remove(['cfe_ratings_cache', 'cfe_cache_time']);
        
        // Reset alarm after clearing cache
        try {
          await chrome.alarms.clear('cacheRefresh');
          if (chrome.alarms?.create) {
            chrome.alarms.create('cacheRefresh', {
              periodInMinutes: 1440
            });
          }
        } catch (e) {
          console.warn('[CFE Background] Could not reset alarm on clear:', e);
        }
        
        sendResponse({ success: true });
        break;
      }

      case 'getCacheStats': {
        if (!globalCache) {
          await loadCacheFromStorage();
        }

        sendResponse({
          count: globalCache ? Object.keys(globalCache).length : 0,
          lastFetch: lastFetchTime,
          age: Date.now() - lastFetchTime
        });
        break;
      }

      case 'fetchUserRating': {
        try {
          const { handle } = request;
          const response = await fetch(`${API_BASE}/user.info?handles=${handle}`);
          const data = await response.json();

          if (data.status === 'OK' && data.result.length > 0) {
            sendResponse({
              rating: data.result[0].rating,
              maxRating: data.result[0].maxRating,
              rank: data.result[0].rank
            });
          } else {
            sendResponse({ error: 'User not found' });
          }
        } catch (e) {
          sendResponse({ error: e.message });
        }
        break;
      }

      default:
        sendResponse({ error: 'Unknown action' });
    }
  })();

  // Return true to indicate async response
  return true;
});

/**
 * Set up periodic cache refresh
 */
try {
  if (chrome.alarms?.create && chrome.alarms?.onAlarm) {
    chrome.alarms.create('cacheRefresh', {
      periodInMinutes: 1440 // Refresh every 24 hours
    });

    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'cacheRefresh') {
        refreshProblemCache();
      }
    });
  }
} catch (e) {
  console.warn('[CFE Background] Alarm setup skipped:', e);
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[CFE Background] Extension installed/updated:', details.reason);

  // Initial cache population
  refreshProblemCache();

  // Set default settings
  chrome.storage.sync.set({
    userRating: null,
    hideTagsAutomatically: true,
    enableGymIntegration: true,
    enableProblemsetRatings: true
  });
});

// Initial cache load on startup
ensureCacheLoaded();
