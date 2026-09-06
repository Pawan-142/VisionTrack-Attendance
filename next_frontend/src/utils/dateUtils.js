/**
 * Returns today's date in YYYY-MM-DD format using the LOCAL timezone.
 * Using toISOString() gives UTC date which can be a day behind in IST (UTC+5:30).
 */
export function localToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
