/** Minimal re-exports to keep events.js self-contained. */
export { normalizeJid, isGroupJid, isStatusJid } from '../utils/validators.js';

export function displayJid(jid) {
  return String(jid ?? '').split('@')[0];
}
