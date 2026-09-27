// Cash economy: pure helpers and tuning. React state lives in hooks/useEconomy.js.

export const CASH_STORAGE_KEY = 'building-picker-cash';

// Cash earned per meter actually driven (forward or reverse). At the
// starter car's ~80 km/h top speed that's roughly $330 per minute.
export const CASH_PER_METER = 0.25;

export function loadCash() {
  try {
    const raw = window.localStorage.getItem(CASH_STORAGE_KEY);
    const value = raw == null ? 0 : Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch (e) {
    return 0;
  }
}

export function saveCash(value) {
  try {
    window.localStorage.setItem(CASH_STORAGE_KEY, String(value));
  } catch (e) {
    // localStorage unavailable (private mode, quota) — cash just won't persist
  }
}

export function formatCash(value) {
  return '$' + Math.floor(value).toLocaleString('en-US');
}
