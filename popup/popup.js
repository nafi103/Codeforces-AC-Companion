const B = typeof browser !== "undefined" ? browser : chrome;

/**
 * CF AC Companion - Popup Script
 * Handles: settings toggles, cache management, user rating input
 */

document.addEventListener('DOMContentLoaded', async () => {
  const hideTagsToggle = document.getElementById('hideTags');
  const enableProblemsetToggle = document.getElementById('enableProblemsetRatings');
  const enableGymToggle = document.getElementById('enableGymIntegration');
  const userRatingInput = document.getElementById('userRating');
  const fetchRatingBtn = document.getElementById('fetchRatingBtn');
  const refreshCacheBtn = document.getElementById('refreshCacheBtn');
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  const cacheCountEl = document.getElementById('cacheCount');
  const cacheAgeEl = document.getElementById('cacheAge');
  const statusIndicator = document.getElementById('statusIndicator');

  let currentSettings = {};

  async function executeScriptInTab(tabId, func) {
    const results = await B.scripting.executeScript({
      target: { tabId },
      func
    });
    return results[0]?.result ?? null;
  }

  function showNotification(message) {
    const existing = document.querySelector('.popup-notification');
    if (existing) existing.remove();

    const notif = document.createElement('div');
    notif.className = 'popup-notification';
    notif.textContent = message;
    document.body.appendChild(notif);

    requestAnimationFrame(() => {
      notif.classList.add('show');
    });

    setTimeout(() => {
      notif.classList.remove('show');
      setTimeout(() => notif.remove(), 300);
    }, 2000);
  }

  async function loadSettings() {
    const defaults = {
      hideTagsAutomatically: true,
      enableProblemsetRatings: true,
      enableGymIntegration: true,
      userRating: null
    };

    try {
      const result = await B.storage.sync.get(defaults);
      currentSettings = result;

      hideTagsToggle.checked = result.hideTagsAutomatically;
      enableProblemsetToggle.checked = result.enableProblemsetRatings;
      enableGymToggle.checked = result.enableGymIntegration;

      if (result.userRating) {
        userRatingInput.value = result.userRating;
      }
    } catch (e) {
      console.error('[CFE Popup] Could not load settings:', e);
      showNotification('Error loading settings');
    }
  }

  async function saveSetting(key, value) {
    try {
      await B.storage.sync.set({ [key]: value });
      currentSettings[key] = value;
      showNotification('Setting saved');
    } catch (e) {
      console.error('[CFE Popup] Could not save setting:', e);
      showNotification('Error saving setting');
    }
  }

  hideTagsToggle.addEventListener('change', (e) => {
    saveSetting('hideTagsAutomatically', e.target.checked);
  });

  enableProblemsetToggle.addEventListener('change', (e) => {
    saveSetting('enableProblemsetRatings', e.target.checked);
  });

  enableGymToggle.addEventListener('change', (e) => {
    saveSetting('enableGymIntegration', e.target.checked);
  });

  userRatingInput.addEventListener('change', async (e) => {
    const raw = e.target.value.trim();
    if (raw === '') {
      await saveSetting('userRating', null);
      showNotification('Baseline set to auto-detect');
      return;
    }

    const value = parseInt(e.target.value);
    if (isNaN(value) || value < 0 || value > 4000) {
      showNotification('Invalid rating (0-4000)');
      return;
    }
    await saveSetting('userRating', value);
  });

  fetchRatingBtn.addEventListener('click', async () => {
    fetchRatingBtn.textContent = '...';
    fetchRatingBtn.disabled = true;

    try {
      const stored = await B.storage.local.get(['cfe_last_handle']);
      let handle = stored.cfe_last_handle || null;

      if (!handle) {
      const tabs = await B.tabs.query({
        active: true,
        currentWindow: true
      });

      const activeTab = tabs[0];
      if (!activeTab?.id) {
        showNotification('No active tab');
        return;
      }

      if (!activeTab?.url?.includes('codeforces.com')) {
        showNotification('Open a Codeforces page first');
        return;
      }

      handle = await executeScriptInTab(activeTab.id, () => {
        const handleLink = document.querySelector('.avatar + a[href*="/profile/"], a[href*="/profile/"]');
        return handleLink ? handleLink.textContent.trim() : null;
      });
    }

      if (!handle) {
        showNotification('Not logged in to Codeforces');
        return;
      }

      // Fetch rating via background script
      const response = await B.runtime.sendMessage({
        action: 'fetchUserRating',
        handle: handle
      });

      if (response.error) {
        showNotification('Could not fetch rating');
      } else {
        userRatingInput.value = response.rating;
        await saveSetting('userRating', response.rating);
        showNotification(`Rating: ${response.rating} (${response.rank})`);
      }
    } catch (e) {
      console.error('[CFE Popup] Fetch rating error:', e);
      showNotification('Error fetching rating');
    } finally {
      fetchRatingBtn.textContent = 'Fetch';
      fetchRatingBtn.disabled = false;
    }
  });

  async function updateCacheStats() {
    try {
      // Get stats from background
      const stats = await B.runtime.sendMessage({ action: 'getCacheStats' });

      if (stats.count !== undefined) {
        cacheCountEl.textContent = stats.count.toLocaleString();
      }

      if (stats.lastFetch) {
        const age = Date.now() - stats.lastFetch;
        const minutes = Math.floor(age / 60000);
        if (minutes < 1) {
          cacheAgeEl.textContent = 'Just now';
        } else if (minutes < 60) {
          cacheAgeEl.textContent = `${minutes}m ago`;
        } else {
          const hours = Math.floor(minutes / 60);
          cacheAgeEl.textContent = `${hours}h ago`;
        }
      } else {
        cacheAgeEl.textContent = 'Never';
      }
    } catch (e) {
      console.warn('[CFE Popup] Could not get cache stats:', e);
      cacheCountEl.textContent = '-';
      cacheAgeEl.textContent = '-';
    }
  }

  refreshCacheBtn.addEventListener('click', async () => {
    refreshCacheBtn.disabled = true;
    refreshCacheBtn.textContent = 'Refreshing...';

    try {
      const result = await B.runtime.sendMessage({ action: 'refreshCache' });
      if (result.success) {
        showNotification(`Cached ${result.count} problems`);
        updateCacheStats();
      } else {
        showNotification('Refresh failed');
      }
    } catch (e) {
      console.error('[CFE Popup] Refresh error:', e);
      showNotification('Error refreshing cache');
    } finally {
      refreshCacheBtn.disabled = false;
      refreshCacheBtn.textContent = 'Refresh';
    }
  });

  clearCacheBtn.addEventListener('click', async () => {
    if (!confirm('Clear all cached ratings?')) return;

    try {
      // Clear via background
      await B.runtime.sendMessage({ action: 'clearCache' });

      const local = await B.storage.local.get(null);
      const keysToRemove = Object.keys(local).filter((key) => key === 'cfe_last_handle' || key.startsWith('cfe_user_'));
      if (keysToRemove.length > 0) {
        await B.storage.local.remove(keysToRemove);
      }

      showNotification('Cache cleared');
      updateCacheStats();
    } catch (e) {
      console.error('[CFE Popup] Clear error:', e);
      showNotification('Error clearing cache');
    }
  });

  async function init() {
    await loadSettings();
    await updateCacheStats();

    // Update status
    const tabs = await B.tabs.query({
      active: true,
      currentWindow: true
    });

    const isCodeforces = tabs[0]?.url?.includes('codeforces.com');
    if (isCodeforces) {
      statusIndicator.className = 'status-indicator active';
      statusIndicator.querySelector('.status-text').textContent = 'Active on Codeforces';
    } else {
      statusIndicator.className = 'status-indicator inactive';
      statusIndicator.querySelector('.status-text').textContent = 'Open Codeforces to use';
    }
  }

  init();
});
