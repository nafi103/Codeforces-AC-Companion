/**
 * CF AC Companion - Shared Utilities
 * Handles: common functions used across content scripts
 */

/**
 * Get rating color based on Codeforces rating
 */
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
