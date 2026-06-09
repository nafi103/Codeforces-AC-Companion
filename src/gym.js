/**
 * CF AC Companion - Gym & Mashup Page Script
 * Handles: parsing original problem IDs from mashup URLs, fetching actual ratings,
 *          injecting ratings into Gym interface
 */

(function() {
  'use strict';

  const B = typeof browser !== 'undefined' ? browser : chrome;

  const API_BASE = 'https://codeforces.com/api';

  async function fetchProblemRating(contestId, problemIndex) {
    try {
      const response = await B.runtime.sendMessage({
        action: 'getRating',
        contestId,
        problemIndex
      });

      if (!response || response.error) {
        return null;
      }

      return Number.isInteger(response.rating) ? response.rating : null;
    } catch (error) {
      console.warn('[CFE] Could not fetch problem rating from background:', error);
      return null;
    }
  }

  /**
   * Extract problem info from Gym/Mashup URL
   */
  function getGymProblemInfo() {
    const url = window.location.pathname;
    // Gym problem: /gym/{gymId}/problem/{problemIndex}
    const gymMatch = url.match(/\/gym\/(\d+)\/problem\/(\w+)/);
    if (gymMatch) {
      return {
        type: 'gym',
        gymId: gymMatch[1],
        problemIndex: gymMatch[2]
      };
    }

    // Mashup problem: /gym/{mashupId}/mashup/{problemIndex} or /contest/{mashupId}/mashup/{problemIndex}
    const mashupMatch = url.match(/\/gym\/(\d+)\/mashup\/(\w+)/) ||
                        url.match(/\/contest\/(\d+)\/mashup\/(\w+)/);
    if (mashupMatch) {
      return {
        type: 'mashup',
        mashupId: mashupMatch[1],
        problemIndex: mashupMatch[2]
      };
    }

    return null;
  }

  /**
   * Try to find original problem ID from mashup statement or page content
   * Mashups often include original problem URLs in their statements
   */
  async function findOriginalProblemId() {
    // Method 1: Look for links to original problems in the problem statement
    const statement = document.querySelector('.problem-statement');
    if (statement) {
      const links = statement.querySelectorAll('a[href*="/problemset/problem/"], a[href*="/contest/"]');
      for (const link of links) {
        const href = link.getAttribute('href');
        const match = href.match(/\/problemset\/problem\/(\d+)\/(\w+)/) ||
                      href.match(/\/contest\/(\d+)\/problem\/(\w+)/);
        if (match) {
          return {
            contestId: match[1],
            problemIndex: match[2]
          };
        }
      }
    }

    // Method 2: Check for problem ID hints in the title
    const title = document.querySelector('.problem-statement .title');
    if (title) {
      const text = title.textContent;
      // Sometimes mashup problems include original ID in format like "Problem A (CF1234A)"
      const idMatch = text.match(/(?:CF|#)(\d+)([A-Z]\d?)/i);
      if (idMatch) {
        return {
          contestId: idMatch[1],
          problemIndex: idMatch[2].toUpperCase()
        };
      }
    }

    // Method 3: Try to get from gym/mashup API
    const gymInfo = getGymProblemInfo();
    if (gymInfo) {
      try {
        const apiUrl = gymInfo.type === 'mashup'
          ? `${API_BASE}/contest.standings?contestId=${gymInfo.mashupId}&from=1&count=1`
          : `${API_BASE}/contest.standings?contestId=${gymInfo.gymId}&from=1&count=1`;

        const response = await fetch(apiUrl);
        const data = await response.json();

        if (data.status === 'OK' && data.result.problems.length > 0) {
          const problems = data.result.problems;
          const targetProblem = problems.find(
            p => p.index === gymInfo.problemIndex
          );

          if (targetProblem) {
            // Check if the problem has original contest info
            if (targetProblem.contestId) {
              return {
                contestId: targetProblem.contestId,
                problemIndex: targetProblem.index
              };
            }
          }

          // Find rating for our specific problem
          const ourProblem = problems.find(p => p.index === gymInfo.problemIndex);
          if (ourProblem && ourProblem.rating) {
            return { rating: ourProblem.rating };
          }
        }
      } catch (e) {
        console.warn('[CFE] Could not fetch gym/mashup info:', e);
      }
    }

    return null;
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
   * Inject rating into gym/mashup problem page
   */
  function injectGymRating(rating) {
    const existing = document.querySelector('.cfe-gym-rating');
    if (existing) return;

    const sidebar = document.querySelector('#sidebar');
    if (!sidebar) return;

    const color = getRatingColor(rating);

    const ratingDiv = document.createElement('div');
    ratingDiv.className = 'cfe-gym-rating';

    const header = document.createElement('div');
    header.className = 'cfe-rating-header';
    header.textContent = 'Original Problem Rating';

    const valueContainer = document.createElement('div');
    valueContainer.className = 'cfe-rating-value-container';

    const valueSpan = document.createElement('span');
    valueSpan.className = 'cfe-rating-value';
    valueSpan.style.color = color;
    valueSpan.textContent = String(rating);

    valueContainer.appendChild(valueSpan);
    ratingDiv.appendChild(header);
    ratingDiv.appendChild(valueContainer);

    sidebar.insertBefore(ratingDiv, sidebar.firstChild);
  }

  /**
   * Inject a note when original problem cannot be found
   */
  function injectUnknownRatingNote() {
    const existing = document.querySelector('.cfe-gym-rating');
    if (existing) return;

    const sidebar = document.querySelector('#sidebar');
    if (!sidebar) return;

    const noteDiv = document.createElement('div');
    noteDiv.className = 'cfe-gym-rating cfe-gym-rating-unknown';

    const noteHeader = document.createElement('div');
    noteHeader.className = 'cfe-rating-header';
    noteHeader.textContent = 'Original Problem Rating';

    const unavailable = document.createElement('div');
    unavailable.className = 'cfe-rating-unavailable';
    unavailable.textContent = 'Could not determine original problem ID';

    const hint = document.createElement('div');
    hint.className = 'cfe-rating-hint';
    hint.textContent = 'Original contest link may be in the problem statement';

    noteDiv.appendChild(noteHeader);
    noteDiv.appendChild(unavailable);
    noteDiv.appendChild(hint);

    sidebar.insertBefore(noteDiv, sidebar.firstChild);
  }

  /**
   * Add standings link for gym/mashup
   */
  function injectGymStandingsLink(contestId, type) {
    const existing = document.querySelector('.cfe-standings-link');
    if (existing) return;

    const sidebar = document.querySelector('#sidebar');
    if (!sidebar) return;

    const prefix = type === 'mashup' ? 'contest' : 'gym';
    const standingsUrl = `/${prefix}/${contestId}/standings`;

    const linkContainer = document.createElement('div');
    linkContainer.className = 'cfe-standings-link';

    const anchor = document.createElement('a');
    anchor.href = standingsUrl;
    anchor.target = '_blank';
    anchor.className = 'cfe-standings-btn';

    const icon = document.createElement('span');
    icon.className = 'cfe-icon';
    icon.textContent = '\u{1F4CA}';

    anchor.appendChild(icon);
    anchor.appendChild(document.createTextNode(` ${type === 'mashup' ? 'Mashup' : 'Gym'} Standings`));
    linkContainer.appendChild(anchor);

    const ratingDisplay = sidebar.querySelector('.cfe-gym-rating');
    if (ratingDisplay) {
      ratingDisplay.insertAdjacentElement('afterend', linkContainer);
    } else {
      sidebar.insertBefore(linkContainer, sidebar.firstChild);
    }
  }


  async function init() {
    console.log('[CFE] Gym/Mashup enhancer initialized');

    const gymInfo = getGymProblemInfo();
    if (!gymInfo) {
      console.warn('[CFE] Not a recognized gym/mashup page');
      return;
    }

    console.log(`[CFE] Detected ${gymInfo.type} page:`, gymInfo);

    // Try to find original problem and its rating
    const originalInfo = await findOriginalProblemId();

    if (originalInfo) {
      if (originalInfo.rating) {
        // Direct rating found from API
        injectGymRating(originalInfo.rating);
      } else if (originalInfo.contestId && originalInfo.problemIndex) {
        // Found original problem ID, fetch its rating
        console.log(`[CFE] Original problem: ${originalInfo.contestId}${originalInfo.problemIndex}`);
        const rating = await fetchProblemRating(originalInfo.contestId, originalInfo.problemIndex);

        if (rating) {
          injectGymRating(rating);
        } else {
          injectUnknownRatingNote();
        }
      }
    } else {
      injectUnknownRatingNote();
    }

    // Add standings link
    const contestId = gymInfo.gymId || gymInfo.mashupId;
    if (contestId) {
      injectGymStandingsLink(contestId, gymInfo.type);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
