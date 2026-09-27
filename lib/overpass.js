// Minimal OpenStreetMap Overpass API client (used for the traffic road network).

import { OVERPASS_MIRRORS } from './constants';

// Some networks silently drop connections to Overpass rather than refusing
// them, so give up on a mirror after this long instead of hanging.
const MIRROR_TIMEOUT_MS = 12000;

/**
 * Runs an Overpass QL query, trying each mirror in turn until one succeeds.
 * Resolves to the response's `elements` array. Throws the last encountered
 * error if every mirror fails.
 */
export async function runOverpassQuery(query) {
  let lastError = null;
  for (const url of OVERPASS_MIRRORS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: controller.signal
      });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url);
      const data = await res.json();
      return data.elements || [];
    } catch (err) {
      console.warn('Overpass mirror failed:', url, err);
      lastError = controller.signal.aborted ? new Error('timed out after ' + MIRROR_TIMEOUT_MS / 1000 + ' s at ' + url) : err;
      // fall through to the next mirror
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('All Overpass mirrors failed');
}
