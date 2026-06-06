/**
 * CF AC Companion - Content Script for Problem Pages
 * Handles: compact difficulty reveal card, target solve suggestion,
 *          top-right countdown timer, and AC-based timer auto-reset.
 */

(function() {
  'use strict';

  const B = typeof browser !== 'undefined' ? browser : chrome;

  const API_BASE = 'https://codeforces.com/api';

  let settings = {
    hideTagsAutomatically: true,
    userRating: null
  };

  const runtime = {
    contestId: null,
    problemIndex: null,
    currentHandle: null,
    problemRating: null,
    baselineRating: null,
    revealed: false,
    solved: false,
    suggestedSeconds: null,
    remainingSeconds: 0,
    timerSessionStarted: false,
    timerRunning: false,
    timerIntervalId: null,
    acceptedPollId: null,
    tagsRetryId: null,
    solvedRetryId: null
  };

  async function sendRuntimeMessage(request) {
    try {
      return await B.runtime.sendMessage(request);
    } catch (error) {
      console.warn('[CFE] Runtime message failed:', error);
      return null;
    }
  }

  async function getStoredUserRating(handle) {
    try {
      const key = `cfe_user_${handle}`;
      const result = await B.storage.local.get([key]);
      const cached = result[key];
      if (Number.isInteger(cached)) {
        return cached;
      }

      if (typeof cached === 'string') {
        const parsed = parseInt(cached, 10);
        return Number.isInteger(parsed) ? parsed : null;
      }

      return null;
    } catch (error) {
      console.warn('[CFE] Could not read stored user rating:', error);
      return null;
    }
  }

  async function setStoredUserRating(handle, rating) {
    try {
      await B.storage.local.set({ [`cfe_user_${handle}`]: rating });
    } catch (error) {
      console.warn('[CFE] Could not store user rating:', error);
    }
  }

  async function setLastKnownHandle(handle) {
    try {
      await B.storage.local.set({ cfe_last_handle: handle });
    } catch (error) {
      console.warn('[CFE] Could not store handle:', error);
    }
  }

  function getProblemIdentifiers() {
    const path = window.location.pathname;
    const match = path.match(/\/problemset\/problem\/(\d+)\/(\w+)/) ||
      path.match(/\/contest\/(\d+)\/problem\/(\w+)/);

    if (!match) {
      return null;
    }

    return {
      contestId: match[1],
      problemIndex: match[2]
    };
  }

  function getCurrentHandle() {
    const handleLink = document.querySelector('.avatar + a[href*="/profile/"], a[href*="/profile/"]');
    if (!handleLink) {
      return null;
    }

    const handle = handleLink.textContent.trim();
    return handle || null;
  }

  function getRatingColor(rating) {
    if (rating >= 3000) return '#aa0000';
    if (rating >= 2600) return '#ff0000';
    if (rating >= 2400) return '#ff0000';
    if (rating >= 2300) return '#ff8c00';
    if (rating >= 2100) return '#ff8c00';
    if (rating >= 1900) return '#aa00aa';
    if (rating >= 1600) return '#0000ff';
    if (rating >= 1400) return '#03a89e';
    if (rating >= 1200) return '#008000';
    return '#808080';
  }

  async function loadSettings() {
    try {
      settings = await B.storage.sync.get({
        hideTagsAutomatically: true,
        userRating: null
      });
    } catch (error) {
      console.warn('[CFE] Could not load settings:', error);
    }
  }

  async function fetchUserRating() {
    try {
      const handle = getCurrentHandle();
      if (!handle) {
        return null;
      }

      await setLastKnownHandle(handle);

      const cached = await getStoredUserRating(handle);
      if (cached) {
        return cached;
      }

      const response = await sendRuntimeMessage({
        action: 'fetchUserRating',
        handle
      });

      if (!response || response.error || !Number.isInteger(response.rating)) {
        return null;
      }

      await setStoredUserRating(handle, response.rating);
      return response.rating;
    } catch (error) {
      console.warn('[CFE] Could not fetch user rating:', error);
      return null;
    }
  }

  async function fetchProblemRating(contestId, problemIndex) {
    try {
      const response = await sendRuntimeMessage({
        action: 'getRating',
        contestId,
        problemIndex
      });

      if (!response || response.error) {
        return null;
      }

      return Number.isInteger(response.rating) ? response.rating : null;
    } catch (error) {
      console.error('[CFE] Could not fetch problem rating:', error);
      return null;
    }
  }

  async function fetchProblemTags(contestId, problemIndex) {
    const cacheKey = `cfe_tags_${contestId}_${problemIndex}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch (error) {
        // Ignore stale cache parse errors.
      }
    }

    try {
      const response = await fetch(`${API_BASE}/problemset.problems`);
      const data = await response.json();
      if (data.status !== 'OK') {
        return [];
      }

      const problem = data.result.problems.find((item) => (
        item.contestId === parseInt(contestId, 10) && item.index === problemIndex
      ));
      const tags = problem && Array.isArray(problem.tags) ? problem.tags : [];
      sessionStorage.setItem(cacheKey, JSON.stringify(tags));
      return tags;
    } catch (error) {
      console.warn('[CFE] Could not fetch problem tags:', error);
      return [];
    }
  }

  function calculateTargetSeconds(baseline, problemRating) {
    const defaultSeconds = 30 * 60;
    if (!baseline || !problemRating) {
      return defaultSeconds;
    }

    const diff = problemRating - baseline;
    // 400 rating delta adds 30 minutes. Rounded to nearest 5 minutes.
    const rawMinutes = 30 + (diff * 0.075);
    const rounded = Math.round(rawMinutes / 5) * 5;
    const bounded = Math.min(120, Math.max(10, rounded));
    return bounded * 60;
  }

  function formatSeconds(seconds) {
    const safe = Math.max(0, seconds | 0);
    const mm = String(Math.floor(safe / 60)).padStart(2, '0');
    const ss = String(safe % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function getTimerStateKey() {
    if (!runtime.contestId || !runtime.problemIndex) {
      return null;
    }
    return `cfe_timer_${runtime.contestId}_${runtime.problemIndex}`;
  }

  function saveTimerState() {
    const key = getTimerStateKey();
    if (!key) {
      return;
    }

    try {
      const state = {
        remainingSeconds: Math.max(0, runtime.remainingSeconds | 0),
        timerSessionStarted: !!runtime.timerSessionStarted,
        timerRunning: !!runtime.timerRunning,
        suggestedSeconds: runtime.suggestedSeconds === null ? null : (runtime.suggestedSeconds | 0),
        updatedAt: Date.now()
      };
      localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      console.warn('[CFE] Could not save timer state:', error);
    }
  }

  function clearTimerState() {
    const key = getTimerStateKey();
    if (!key) {
      return;
    }

    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn('[CFE] Could not clear timer state:', error);
    }
  }

  function restoreTimerState() {
    const key = getTimerStateKey();
    if (!key) {
      return;
    }

    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return;
      }

      const state = JSON.parse(raw);
      if (!state || typeof state !== 'object') {
        return;
      }

      runtime.suggestedSeconds = Number.isInteger(state.suggestedSeconds)
        ? Math.max(0, state.suggestedSeconds)
        : null;

      runtime.remainingSeconds = Number.isInteger(state.remainingSeconds)
        ? Math.max(0, state.remainingSeconds)
        : 0;

      runtime.timerSessionStarted = !!state.timerSessionStarted;
      runtime.timerRunning = !!state.timerRunning;

      if (runtime.timerRunning) {
        const updatedAt = Number.isFinite(state.updatedAt) ? state.updatedAt : Date.now();
        const elapsed = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
        runtime.remainingSeconds = Math.max(0, runtime.remainingSeconds - elapsed);

        if (runtime.remainingSeconds === 0) {
          runtime.timerRunning = false;
          runtime.timerSessionStarted = false;
        }
      }
    } catch (error) {
      console.warn('[CFE] Could not restore timer state:', error);
    }
  }

  function parseTimeInput(input) {
    const text = (input || '').trim();
    const match = text.match(/^(\d{1,3}):(\d{2})$/);
    if (!match) {
      return null;
    }

    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    if (Number.isNaN(minutes) || Number.isNaN(seconds) || seconds >= 60) {
      return null;
    }

    return (minutes * 60) + seconds;
  }

  function isActiveContestContext() {
    const path = window.location.pathname;
    const isContestProblem = /\/contest\/\d+\/problem\//.test(path);
    if (!isContestProblem) {
      return false;
    }

    const sidebar = document.querySelector('#sidebar');
    if (!sidebar) {
      return false;
    }

    // The first roundbox on contest problem pages is the contest status card.
    const statusBox = sidebar.querySelector('.roundbox');
    if (!statusBox) {
      return false;
    }

    const statusText = statusBox.textContent.toLowerCase();
    return statusText.includes('contest is running') || statusText.includes('out of competition');
  }

  function isFinishedContestPage() {
    const path = window.location.pathname;
    if (!/\/contest\/\d+\/problem\//.test(path)) {
      return false;
    }

    const sidebar = document.querySelector('#sidebar');
    if (!sidebar) {
      return false;
    }

    const firstBox = sidebar.querySelector('.roundbox');
    if (!firstBox) {
      return false;
    }

    const firstBoxText = firstBox.textContent.toLowerCase();
    return firstBoxText.includes('finished');
  }

  function cleanupInjectedUI() {
    const selectors = [
      '.cfe-compact-card',
      '.cfe-timer-module',
      '.cfe-solved-status-card',
      '.cfe-show-tags-btn',
      '.cfe-generated-tags'
    ];

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => node.remove());
    });
  }

  function scheduleSolvedStateRefresh() {
    if (runtime.solvedRetryId) {
      clearInterval(runtime.solvedRetryId);
      runtime.solvedRetryId = null;
    }

    let retries = 0;
    runtime.solvedRetryId = setInterval(async () => {
      retries += 1;
      const solved = await detectSolvedState(runtime.contestId, runtime.problemIndex, runtime.currentHandle);
      if (solved !== runtime.solved) {
        runtime.solved = solved;
        updateCardSolvedBadge();
      }

      if (runtime.solved || retries >= 10) {
        clearInterval(runtime.solvedRetryId);
        runtime.solvedRetryId = null;
      }
    }, 700);
  }

  function detectSolvedFromLastSubmissions() {
    const sidebar = document.querySelector('#sidebar');
    if (!sidebar) {
      return false;
    }

    // On finished contests, the sidebar often includes a Last submissions box.
    const lastSubmissionsBox = Array.from(sidebar.querySelectorAll('.roundbox')).find((box) => {
      const title = box.querySelector('.title');
      return title && title.textContent.toLowerCase().includes('last submissions');
    });

    if (!lastSubmissionsBox) {
      return false;
    }

    const acceptedCell = Array.from(lastSubmissionsBox.querySelectorAll('td, span, div')).some((node) => {
      const text = node.textContent.trim().toLowerCase();
      return text === 'accepted' || text.includes('accepted');
    });

    return acceptedCell;
  }

  function detectSolvedFromSidebar() {
    const sidebar = document.querySelector('#sidebar');
    if (!sidebar) {
      return false;
    }

    const boxes = Array.from(sidebar.querySelectorAll('.roundbox'));
    return boxes.some((box) => {
      const text = box.textContent.toLowerCase();
      return text.includes('accepted');
    });
  }

  async function detectSolvedState(contestId, problemIndex, currentHandle) {
    if (detectSolvedFromSidebar()) {
      return true;
    }

    if (currentHandle) {
      try {
        const url = `${API_BASE}/user.status?handle=${encodeURIComponent(currentHandle)}&from=1&count=200`;
        const response = await fetch(url, { credentials: 'omit' });
        const data = await response.json();
        if (data.status === 'OK' && Array.isArray(data.result)) {
          const accepted = data.result.some((submission) => {
            const sameContest = String(submission.contestId) === String(contestId);
            const sameIndex = submission.problem && String(submission.problem.index) === String(problemIndex);
            return sameContest && sameIndex && submission.verdict === 'OK';
          });

          if (accepted) {
            return true;
          }
        }
      } catch (error) {
        console.warn('[CFE] Initial solved-state check via user.status failed:', error);
      }
    }

    return detectSolvedFromLastSubmissions();
  }

  function ensureSolvedCardPlacement() {
    const card = document.querySelector('.cfe-solved-status-card');
    if (!card) {
      return;
    }

    const timer = document.querySelector('.cfe-timer-module');
    if (timer && timer.parentElement) {
      timer.insertAdjacentElement('beforebegin', card);
      return;
    }

    const sidebar = document.querySelector('#sidebar');
    if (!sidebar) {
      return;
    }

    const compactCard = document.querySelector('.cfe-compact-card');
    if (compactCard && compactCard.parentElement === sidebar) {
      compactCard.insertAdjacentElement('beforebegin', card);
    } else {
      sidebar.appendChild(card);
    }
  }

  function toggleTags(container, button) {
    const hidden = button.dataset.hidden === 'true';
    const tagBoxes = container.querySelectorAll('.tag-box');

    tagBoxes.forEach((box) => {
      box.style.display = hidden ? '' : 'none';
    });

    button.textContent = hidden ? 'Hide Tags' : 'Show Tags';
    button.dataset.hidden = hidden ? 'false' : 'true';
  }

  function hideTags() {
    const tagContainers = document.querySelectorAll('.roundbox');
    tagContainers.forEach((container) => {
      const title = container.querySelector('.title');
      if (!title || !title.textContent.toLowerCase().includes('tags')) {
        return;
      }

      const tagBoxes = container.querySelectorAll('.tag-box');
      if (container.dataset.cfeProcessed) {
        return;
      }

      container.dataset.cfeProcessed = 'true';
      const shouldStartHidden = !!settings.hideTagsAutomatically;
      if (tagBoxes.length > 0) {
        tagBoxes.forEach((box) => {
          box.style.display = shouldStartHidden ? 'none' : '';
        });
      }

      const showBtn = document.createElement('button');
      showBtn.className = 'cfe-show-tags-btn';
      title.insertAdjacentElement('afterend', showBtn);

      if (tagBoxes.length > 0) {
        showBtn.textContent = shouldStartHidden ? 'Show Tags' : 'Hide Tags';
        showBtn.dataset.hidden = shouldStartHidden ? 'true' : 'false';
        showBtn.addEventListener('click', () => toggleTags(container, showBtn));
        return;
      }

      const generatedBox = document.createElement('div');
      generatedBox.className = 'cfe-generated-tags cfe-hidden';
      generatedBox.dataset.loaded = 'false';
      title.insertAdjacentElement('afterend', generatedBox);

      const revealFetchedTags = async () => {
        const hidden = showBtn.dataset.hidden === 'true';
        if (!hidden) {
          generatedBox.classList.add('cfe-hidden');
          showBtn.textContent = 'Show Tags';
          showBtn.dataset.hidden = 'true';
          return;
        }

        if (generatedBox.dataset.loaded !== 'true') {
          showBtn.disabled = true;
          showBtn.textContent = 'Loading...';
          const tags = await fetchProblemTags(runtime.contestId, runtime.problemIndex);
          generatedBox.innerHTML = '';

          if (tags.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'cfe-tags-empty';
            empty.textContent = 'No tags available';
            generatedBox.appendChild(empty);
          } else {
            tags.forEach((tag) => {
              const chip = document.createElement('span');
              chip.className = 'tag-box';
              chip.textContent = tag;
              generatedBox.appendChild(chip);
            });
          }

          generatedBox.dataset.loaded = 'true';
          showBtn.disabled = false;
        }

        generatedBox.classList.remove('cfe-hidden');
        showBtn.textContent = 'Hide Tags';
        showBtn.dataset.hidden = 'false';
      };

      showBtn.textContent = 'Show Tags';
      showBtn.dataset.hidden = 'true';
      showBtn.addEventListener('click', revealFetchedTags);

      if (!shouldStartHidden) {
        revealFetchedTags();
      }
    });
  }

  function getStandingsUrl(contestId) {
    return `/contest/${contestId}/standings`;
  }

  async function toggleCardTags(button, container) {
    const isHidden = button.dataset.hidden === 'true';

    if (!isHidden) {
      container.classList.add('cfe-hidden');
      button.textContent = 'Tags';
      button.dataset.hidden = 'true';
      return;
    }

    if (container.dataset.loaded !== 'true') {
      button.disabled = true;
      button.textContent = 'Loading';

      const tags = await fetchProblemTags(runtime.contestId, runtime.problemIndex);
      container.innerHTML = '';

      if (tags.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'cfe-tags-empty';
        empty.textContent = 'No tags available';
        container.appendChild(empty);
      } else {
        tags.forEach((tag) => {
          const chip = document.createElement('span');
          chip.className = 'tag-box';
          chip.textContent = tag;
          container.appendChild(chip);
        });
      }

      container.dataset.loaded = 'true';
      button.disabled = false;
    }

    container.classList.remove('cfe-hidden');
    button.textContent = 'Tags';
    button.dataset.hidden = 'false';
  }

  function injectCompactCard() {
    const sidebar = document.querySelector('#sidebar');
    if (!sidebar) {
      return;
    }

    const existing = document.querySelector('.cfe-compact-card');
    if (existing) {
      existing.remove();
    }

    const ratingText = runtime.problemRating ? '????' : 'N/A';

    const card = document.createElement('div');
    card.className = 'cfe-compact-card';
    card.innerHTML = `
      <div class="cfe-card-title">&#8594; CF GetRating</div>
      <div class="cfe-rating-tags-inline">
        <span class="tag-box cfe-rating-pill cfe-fog-value cfe-difficulty-value" data-rating="${runtime.problemRating || ''}">${ratingText}</span>
        <span class="cfe-generated-tags cfe-card-tags cfe-hidden" data-loaded="false"></span>
      </div>
      <div class="cfe-compact-actions">
        <button type="button" class="cfe-cf-btn cfe-reveal-rating-btn" ${runtime.problemRating ? '' : 'disabled'}>Rating</button>
        <a class="cfe-cf-btn cfe-cf-btn-secondary" href="${getStandingsUrl(runtime.contestId)}" target="_blank">Standing</a>
        <button type="button" class="cfe-cf-btn cfe-cf-btn-secondary cfe-card-tags-btn" data-hidden="true">Tags</button>
      </div>
    `;

    sidebar.appendChild(card);

    const revealBtn = card.querySelector('.cfe-reveal-rating-btn');
    revealBtn.addEventListener('click', revealAndSuggest);

    const cardTagsBtn = card.querySelector('.cfe-card-tags-btn');
    const cardTagsContainer = card.querySelector('.cfe-card-tags');
    if (cardTagsBtn && cardTagsContainer) {
      cardTagsBtn.addEventListener('click', () => toggleCardTags(cardTagsBtn, cardTagsContainer));
    }

    updateCardSolvedBadge();
  }

  function updateCardSolvedBadge() {
    const card = document.querySelector('.cfe-compact-card');
    if (!card) {
      return;
    }

    // Keep the compact card visible until a solved state is confirmed.
    card.classList.toggle('cfe-hidden', runtime.solved);
    injectSolvedStatusCard();
  }

  function injectSolvedStatusCard() {
    const existing = document.querySelector('.cfe-solved-status-card');
    if (existing) {
      existing.remove();
    }

    if (!runtime.solved) {
      return;
    }

    const card = document.createElement('div');
    card.className = 'cfe-solved-status-card';
    card.classList.add('cfe-solved');
    card.innerHTML = '<div class="cfe-solved-status-text">Solved</div>';

    const sidebar = document.querySelector('#sidebar');
    const timer = document.querySelector('.cfe-timer-module');
    if (timer && timer.parentElement) {
      timer.insertAdjacentElement('beforebegin', card);
    } else if (sidebar) {
      const compactCard = document.querySelector('.cfe-compact-card');
      if (compactCard && compactCard.parentElement === sidebar) {
        compactCard.insertAdjacentElement('beforebegin', card);
      } else {
        sidebar.appendChild(card);
      }
    }
  }

  function revealRatingChip() {
    if (!runtime.problemRating) {
      return;
    }

    const valueEl = document.querySelector('.cfe-difficulty-value');
    if (!valueEl) {
      return;
    }

    valueEl.classList.remove('cfe-fog-value');
    valueEl.textContent = String(runtime.problemRating);
    valueEl.style.color = getRatingColor(runtime.problemRating);
    runtime.revealed = true;
  }

  async function ensureCardTagsVisible() {
    const cardTagsBtn = document.querySelector('.cfe-card-tags-btn');
    const cardTagsContainer = document.querySelector('.cfe-card-tags');
    if (!cardTagsBtn || !cardTagsContainer) {
      return;
    }

    if (cardTagsBtn.dataset.hidden === 'true') {
      await toggleCardTags(cardTagsBtn, cardTagsContainer);
    } else {
      cardTagsContainer.classList.remove('cfe-hidden');
    }
  }

  function revealAndSuggest() {
    if (runtime.revealed || !runtime.problemRating) {
      return;
    }

    runtime.revealed = true;
    const revealBtn = document.querySelector('.cfe-reveal-rating-btn');
    revealRatingChip();

    if (revealBtn) {
      revealBtn.disabled = true;
      revealBtn.textContent = 'Rating';
    }
  }

  function injectTimerModule() {
    const existing = document.querySelector('.cfe-timer-module');
    if (existing) {
      existing.remove();
    }

    const timer = document.createElement('div');
    timer.className = 'cfe-timer-module';
    timer.innerHTML = `
      <div class="cfe-timer-header">Set target time</div>
      <div class="cfe-timer-display">00:00</div>
      <div class="cfe-timer-controls">
        <input type="text" class="cfe-timer-input" placeholder="MM:SS" value="00:00">
        <button type="button" class="cfe-cf-btn cfe-timer-toggle-btn">Start</button>
        <button type="button" class="cfe-cf-btn cfe-cf-btn-secondary cfe-use-suggested-btn">Use Suggested</button>
        <button type="button" class="cfe-cf-btn cfe-cf-btn-secondary cfe-reset-btn cfe-hidden">Reset</button>
      </div>
    `;

    const sidebar = document.querySelector('#sidebar');
    if (sidebar) {
      const roundboxes = Array.from(sidebar.querySelectorAll('.roundbox'));
      const virtualBox = roundboxes.find((box) => {
        const title = box.querySelector('.title');
        return title && title.textContent.toLowerCase().includes('virtual');
      });
      const contestBox = roundboxes.find((box) => {
        const contestLink = box.querySelector('a[href*="/contest/"]');
        return !!contestLink;
      });

      if (contestBox) {
        contestBox.insertAdjacentElement('afterend', timer);
      } else if (virtualBox) {
        sidebar.insertBefore(timer, virtualBox);
      } else {
        sidebar.appendChild(timer);
      }
    } else {
      document.body.appendChild(timer);
    }

    const input = timer.querySelector('.cfe-timer-input');
    const toggleBtn = timer.querySelector('.cfe-timer-toggle-btn');
    const suggestedBtn = timer.querySelector('.cfe-use-suggested-btn');
    const resetBtn = timer.querySelector('.cfe-reset-btn');

    input.addEventListener('change', () => {
      const parsed = parseTimeInput(input.value);
      if (parsed === null) {
        input.classList.add('cfe-input-error');
        return;
      }

      input.classList.remove('cfe-input-error');
      runtime.remainingSeconds = parsed;
      updateTimerDisplay();
    });

    toggleBtn.addEventListener('click', () => {
      if (runtime.timerRunning) {
        pauseTimer();
        return;
      }

      let initialSeconds = runtime.remainingSeconds;
      if (!runtime.timerSessionStarted || initialSeconds <= 0) {
        const parsed = parseTimeInput(input.value);
        if (parsed !== null) {
          initialSeconds = parsed;
        } else if (runtime.suggestedSeconds) {
          initialSeconds = runtime.suggestedSeconds;
        } else {
          initialSeconds = 30 * 60;
        }
      }

      runtime.remainingSeconds = initialSeconds;
      runtime.timerSessionStarted = true;
      startTimer();
    });

    suggestedBtn.addEventListener('click', () => {
      runtime.suggestedSeconds = calculateTargetSeconds(runtime.baselineRating, runtime.problemRating);
      runtime.remainingSeconds = runtime.suggestedSeconds;
      input.value = formatSeconds(runtime.suggestedSeconds);
      input.classList.remove('cfe-input-error');
      updateTimerDisplay();
    });

    resetBtn.addEventListener('click', () => {
      resetTimer();
    });

    updateTimerDisplay();

    if (runtime.timerRunning && runtime.remainingSeconds > 0) {
      startTimer();
    }
  }

  function updateTimerDisplay() {
    const display = document.querySelector('.cfe-timer-display');
    const header = document.querySelector('.cfe-timer-header');
    const toggleBtn = document.querySelector('.cfe-timer-toggle-btn');
    const suggestedBtn = document.querySelector('.cfe-use-suggested-btn');
    const resetBtn = document.querySelector('.cfe-reset-btn');
    const input = document.querySelector('.cfe-timer-input');
    if (!display || !toggleBtn) {
      return;
    }

    display.textContent = formatSeconds(runtime.remainingSeconds);
    display.classList.toggle('cfe-urgent', runtime.remainingSeconds > 0 && runtime.remainingSeconds < 300);
    toggleBtn.textContent = runtime.timerRunning ? 'Pause' : 'Start';
    if (header) {
      header.textContent = runtime.timerRunning || runtime.timerSessionStarted ? 'Clock is ticking' : 'Set target time';
    }

    if (runtime.timerSessionStarted) {
      if (input) {
        input.classList.add('cfe-hidden');
      }
      if (suggestedBtn) {
        suggestedBtn.classList.add('cfe-hidden');
      }
      if (resetBtn) {
        resetBtn.classList.remove('cfe-hidden');
      }
    } else {
      if (input) {
        input.classList.remove('cfe-hidden');
      }
      if (suggestedBtn) {
        suggestedBtn.classList.remove('cfe-hidden');
      }
      if (resetBtn) {
        resetBtn.classList.add('cfe-hidden');
      }
    }

    if (suggestedBtn) {
      suggestedBtn.disabled = false;
    }

    saveTimerState();
  }

  function startTimer() {
    if (runtime.timerIntervalId) {
      clearInterval(runtime.timerIntervalId);
    }

    runtime.timerRunning = true;
    updateTimerDisplay();

    // Use absolute endTime to survive background tab throttling
    const endTime = Date.now() + (runtime.remainingSeconds * 1000);
    runtime.timerIntervalId = setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
      if (remaining !== runtime.remainingSeconds) {
        runtime.remainingSeconds = remaining;
        updateTimerDisplay();
      }

      if (runtime.remainingSeconds === 0) {
        pauseTimer();
      }
    }, 1000);
  }

  function pauseTimer(resetToZero = false) {
    runtime.timerRunning = false;

    if (runtime.timerIntervalId) {
      clearInterval(runtime.timerIntervalId);
      runtime.timerIntervalId = null;
    }

    if (resetToZero) {
      runtime.remainingSeconds = 0;
      runtime.timerSessionStarted = false;
      const input = document.querySelector('.cfe-timer-input');
      if (input) {
        input.value = '00:00';
      }
    }

    updateTimerDisplay();
  }

  function resetTimer() {
    if (runtime.timerIntervalId) {
      clearInterval(runtime.timerIntervalId);
      runtime.timerIntervalId = null;
    }

    runtime.timerRunning = false;
    runtime.timerSessionStarted = false;
    runtime.remainingSeconds = 0;

    const input = document.querySelector('.cfe-timer-input');
    if (input) {
      input.value = '00:00';
      input.classList.remove('cfe-input-error');
    }

    updateTimerDisplay();
  }

  async function isProblemAccepted(contestId, problemIndex, currentHandle) {
    if (!currentHandle) {
      return false;
    }

    const url = `${API_BASE}/user.status?handle=${encodeURIComponent(currentHandle)}&from=1&count=50`;
    try {
      const response = await fetch(url, { credentials: 'omit' });
      const data = await response.json();
      if (data.status !== 'OK' || !Array.isArray(data.result)) {
        return false;
      }

      return data.result.some((submission) => {
        const sameContest = String(submission.contestId) === String(contestId);
        const sameIndex = submission.problem && String(submission.problem.index) === String(problemIndex);
        const accepted = submission.verdict === 'OK';
        return sameContest && sameIndex && accepted;
      });
    } catch (error) {
      console.warn('[CFE] user.status API check failed:', error);
      return false;
    }
  }

  async function onProblemSolved() {
    if (runtime.solved) {
      return;
    }

    runtime.solved = true;
    pauseTimer(true);
    clearTimerState();
    updateCardSolvedBadge();
  }

  function startAcceptedPolling() {
    if (!runtime.currentHandle || runtime.solved) {
      return;
    }

    const pollChannel = new BroadcastChannel(`cfe_poll_${runtime.currentHandle}`);
    let isLeader = false;
    let leaderHeartbeatTimer = null;
    let leaderCheckTimer = null;

    async function becomeLeader() {
      if (isLeader) return;
      isLeader = true;

      console.log('[CFE] Became polling leader');

      const tick = async () => {
        if (runtime.solved) {
          isLeader = false;
          if (leaderHeartbeatTimer) clearInterval(leaderHeartbeatTimer);
          return;
        }

        try {
          const accepted = await isProblemAccepted(runtime.contestId, runtime.problemIndex, runtime.currentHandle);
          if (accepted) {
            await onProblemSolved();
            pollChannel.postMessage({ type: 'solved', contestId: runtime.contestId, problemIndex: runtime.problemIndex });
          }
        } catch (error) {
          console.warn('[CFE] Polling error:', error);
        }
      };

      tick();
      leaderHeartbeatTimer = setInterval(tick, 15000);
    }

    function checkLeadership() {
      if (!document.hidden && !isLeader) {
        becomeLeader();
      } else if (document.hidden && isLeader) {
        isLeader = false;
        if (leaderHeartbeatTimer) {
          clearInterval(leaderHeartbeatTimer);
          leaderHeartbeatTimer = null;
        }
        console.log('[CFE] Relinquished polling leadership');
      }
    }

    pollChannel.onmessage = (event) => {
      const { type, contestId, problemIndex } = event.data;
      if (type === 'solved' && contestId === runtime.contestId && problemIndex === runtime.problemIndex) {
        if (!runtime.solved) {
          onProblemSolved();
        }
      }
    };

    document.addEventListener('visibilitychange', checkLeadership);
    leaderCheckTimer = setInterval(checkLeadership, 1000);

    runtime.acceptedPollId = { channel: pollChannel, leaderHeartbeatTimer, leaderCheckTimer };
    checkLeadership();
  }

  async function init() {
    const identifiers = getProblemIdentifiers();
    if (!identifiers) {
      return;
    }

    runtime.contestId = identifiers.contestId;
    runtime.problemIndex = identifiers.problemIndex;
    runtime.currentHandle = getCurrentHandle();

    if (runtime.currentHandle) {
      await setLastKnownHandle(runtime.currentHandle);
    }

    runtime.solved = await detectSolvedState(runtime.contestId, runtime.problemIndex, runtime.currentHandle);

    restoreTimerState();

    await loadSettings();
    setTimeout(hideTags, 300);
    if (runtime.tagsRetryId) {
      clearInterval(runtime.tagsRetryId);
      runtime.tagsRetryId = null;
    }

    let retries = 0;
    runtime.tagsRetryId = setInterval(() => {
      hideTags();
      retries += 1;
      if (document.querySelector('.cfe-show-tags-btn') || retries >= 12) {
        clearInterval(runtime.tagsRetryId);
        runtime.tagsRetryId = null;
      }
    }, 500);

    runtime.problemRating = await fetchProblemRating(runtime.contestId, runtime.problemIndex);
    runtime.baselineRating = settings.userRating || await fetchUserRating();
    if (runtime.suggestedSeconds === null) {
      runtime.suggestedSeconds = null;
    }
    if (!runtime.remainingSeconds) {
      runtime.remainingSeconds = 0;
    }

    injectCompactCard();
    injectTimerModule();
    ensureSolvedCardPlacement();

    // Re-check once after the UI is injected, because Codeforces can render
    // sidebar widgets late on older/problemset pages.
    setTimeout(async () => {
      const refreshedSolved = await detectSolvedState(runtime.contestId, runtime.problemIndex, runtime.currentHandle);
      if (refreshedSolved !== runtime.solved) {
        runtime.solved = refreshedSolved;
        updateCardSolvedBadge();
      } else if (runtime.solved) {
        // If solved was already true, ensure the solved card is present.
        updateCardSolvedBadge();
      }
      ensureSolvedCardPlacement();
    }, 800);

    if (!runtime.solved) {
      scheduleSolvedStateRefresh();
    }
    if (runtime.currentHandle) {
      startAcceptedPolling();
    }

    B.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'sync') {
        return;
      }

      if (changes.userRating) {
        runtime.baselineRating = changes.userRating.newValue;
        runtime.suggestedSeconds = calculateTargetSeconds(runtime.baselineRating, runtime.problemRating);

        updateTimerDisplay();
      }
    });
  }

  window.addEventListener('beforeunload', () => {
    saveTimerState();
    if (runtime.timerIntervalId) {
      clearInterval(runtime.timerIntervalId);
      runtime.timerIntervalId = null;
    }
    if (runtime.acceptedPollId) {
      if (runtime.acceptedPollId.leaderHeartbeatTimer) {
        clearInterval(runtime.acceptedPollId.leaderHeartbeatTimer);
      }
      if (runtime.acceptedPollId.leaderCheckTimer) {
        clearInterval(runtime.acceptedPollId.leaderCheckTimer);
      }
      if (runtime.acceptedPollId.channel) {
        runtime.acceptedPollId.channel.close();
      }
      runtime.acceptedPollId = null;
    }
    if (runtime.tagsRetryId) {
      clearInterval(runtime.tagsRetryId);
      runtime.tagsRetryId = null;
    }
    if (runtime.solvedRetryId) {
      clearInterval(runtime.solvedRetryId);
      runtime.solvedRetryId = null;
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
