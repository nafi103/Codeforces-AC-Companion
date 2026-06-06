/**
 * CF AC Companion - Problemset Page Script
 * Handles: batch rating fetching, rating display on problemset list
 */

(function() {
  'use strict';

  const B = typeof browser !== 'undefined' ? browser : chrome;

  /**
   * Extract all visible problem IDs from the problemset table
   */
  function extractVisibleProblems() {
    const problems = [];
    const rows = document.querySelectorAll('#pageContent .problems tr');

    rows.forEach(row => {
      const idCell = row.querySelector('td.id');
      const link = row.querySelector('td a[href*="/problemset/problem/"]');

      if (idCell && link) {
        const href = link.getAttribute('href');
        const match = href.match(/\/problemset\/problem\/(\d+)\/(\w+)/);
        if (match) {
          problems.push({
            contestId: match[1],
            problemIndex: match[2],
            row: row
          });
        }
      }
    });

    return problems;
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

  /**
   * Inject rating badge into a problem row
   */
  function injectRatingBadge(row, rating) {
    // Check if already injected
    if (row.querySelector('.cfe-problemset-rating')) return;

    const titleCell = row.querySelector('td div[style*="float:left"]');
    if (!titleCell) return;

    const color = getRatingColor(rating);

    const badge = document.createElement('span');
    badge.className = 'cfe-problemset-rating';
    badge.style.cssText = `
      display: inline-block;
      margin-left: 8px;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: bold;
      color: ${color};
      border: 1px solid ${color}40;
      background: ${color}10;
      vertical-align: middle;
    `;
    badge.textContent = rating;

    // Insert after the problem title link
    const problemLink = titleCell.querySelector('a');
    if (problemLink) {
      problemLink.insertAdjacentElement('afterend', badge);
    } else {
      titleCell.appendChild(badge);
    }
  }

  /**
   * Inject rating badge for unsolved problems (respecting tag hiding)
   */
  function injectUnsolvedRatingBadge(row, rating) {
    if (row.querySelector('.cfe-unsolved-rating')) return;

    const tagsCell = row.querySelector('td .notice');
    if (!tagsCell) return;

    const color = getRatingColor(rating);

    const badge = document.createElement('span');
    badge.className = 'cfe-unsolved-rating';
    badge.style.cssText = `
      display: inline-block;
      margin-right: 8px;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
      color: ${color};
      border: 1px solid ${color}40;
      background: ${color}15;
    `;
    badge.textContent = `Rating: ${rating}`;

    tagsCell.insertBefore(badge, tagsCell.firstChild);
  }

  /**
   * Fetch all problem ratings in batch
   */
  function applyRatings(problems, ratings) {
    const ratingMap = new Map(
      ratings
        .filter((item) => Number.isInteger(item.rating))
        .map((item) => [`${item.contestId}_${item.problemIndex}`, item.rating])
    );

    let applied = 0;
    for (const problem of problems) {
      const rating = ratingMap.get(`${problem.contestId}_${problem.problemIndex}`);
      if (rating) {
        const tagsNotice = problem.row.querySelector('td .notice');
        if (tagsNotice && tagsNotice.textContent.toLowerCase().includes('hidden')) {
          injectUnsolvedRatingBadge(problem.row, rating);
        }
        injectRatingBadge(problem.row, rating);
        applied++;
      }
    }

    console.log(`[CFE] Applied ratings to ${applied} problems on problemset page`);
  }

  /**
   * Fetch all problem ratings in batch from the background cache
   */
  async function fetchAllRatings() {
    const problems = extractVisibleProblems();
    if (problems.length === 0) {
      return;
    }

    try {
      const response = await B.runtime.sendMessage({
        action: 'getBatchRatings',
        problems: problems.map((problem) => ({
          contestId: problem.contestId,
          problemIndex: problem.problemIndex
        }))
      });

      if (response && Array.isArray(response.results)) {
        applyRatings(problems, response.results);
      }
    } catch (e) {
      console.warn('[CFE] Could not fetch problemset ratings:', e);
    }
  }

  /**
   * Hide tags on problemset page for unsolved problems
   */
  function hideTagsOnProblemset() {
    // This is handled by Codeforces native setting
    // We just inject ratings where tags are hidden
    const tagNotices = document.querySelectorAll('.problems td .notice');
    tagNotices.forEach(notice => {
      if (notice.textContent.toLowerCase().includes('hidden') &&
          !notice.dataset.cfeProcessed) {
        notice.dataset.cfeProcessed = 'true';
        // The rating badge will be injected by applyCachedRatings
      }
    });
  }

  async function init() {
    console.log('[CFE] Problemset page enhancer initialized');

    // Hide tags and inject ratings
    hideTagsOnProblemset();

    // Fetch fresh data and apply
    await fetchAllRatings();

    // Watch for page changes (pagination)
    let debounceTimer = null;

    const observer = new MutationObserver((mutations) => {
      let shouldRefresh = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          shouldRefresh = true;
          break;
        }
      }
      if (shouldRefresh) {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
          hideTagsOnProblemset();
          fetchAllRatings();
          debounceTimer = null;
        }, 300);
      }
    });

    const pageContent = document.querySelector('#pageContent');
    if (pageContent) {
      observer.observe(pageContent, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
