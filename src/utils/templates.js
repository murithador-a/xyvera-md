/**
 * Template rendering for welcome/goodbye messages.
 * Placeholders: {user}, {group}, and any extra vars passed in.
 * `{{` and `}}` escape to literal braces. Unknown placeholders are left as-is
 * and reported in `missing` so callers can warn instead of silently failing.
 */

const PLACEHOLDER_RE = /\{([a-zA-Z0-9_]+)\}/g;

export function renderTemplate(template, vars = {}) {
  const src = String(template ?? '');
  const missing = [];
  // Protect escaped braces
  const ESC_L = '\u0000ESC_L\u0000';
  const ESC_R = '\u0000ESC_R\u0000';
  let out = src.replaceAll('{{', ESC_L).replaceAll('}}', ESC_R);

  out = out.replace(PLACEHOLDER_RE, (whole, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key) && vars[key] !== undefined && vars[key] !== null) {
      return String(vars[key]);
    }
    missing.push(key);
    return whole; // leave visible so it is obvious in tests/debug
  });

  return {
    text: out.replaceAll(ESC_L, '{').replaceAll(ESC_R, '}'),
    missing,
  };
}

/** Extract placeholder names used by a template (for .setwelcome validation/preview). */
export function templatePlaceholders(template) {
  const names = new Set();
  for (const m of String(template ?? '').matchAll(PLACEHOLDER_RE)) names.add(m[1]);
  return [...names];
}

export const KNOWN_PLACEHOLDERS = Object.freeze(['user', 'group']);
