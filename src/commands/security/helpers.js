/** Helpers for security commands. */

import { extractDomain as _extractDomain, normalizeJid } from '../../utils/validators.js';

export function extractDomain(input) {
  return _extractDomain(input);
}

export { normalizeJid };
