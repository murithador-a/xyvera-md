/**
 * External provider catalog — the SINGLE source of truth for which env vars
 * each integration needs.
 *
 * Used by `.configcheck`, `node src/index.js --doctor`, and the docs so the
 * operator never sees two different answers about whether a feature is ready.
 *
 * Rules (docs/ARCHITECTURE.md §11):
 *  - A provider is "configured" only when its REQUIRED variables are present.
 *  - Keyless providers are configured by default (documented free endpoints).
 *  - Nothing here performs network I/O — this is a static requirements matrix.
 */

/**
 * @typedef {object} Provider
 * @property {string} id            stable identifier
 * @property {string} label         human label (shown in chat and in reports)
 * @property {string} feature       feature description
 * @property {string[]} requires    env vars that MUST be non-empty
 * @property {string[]} optional    env vars that tune the provider
 * @property {boolean} keyless      true = usable with no configuration at all
 * @property {string} note          honest description of the provider/limits
 */

/** @type {ReadonlyArray<Provider>} */
export const PROVIDERS = Object.freeze([
  Object.freeze({
    id: 'ai',
    label: 'AI chat (.ai)',
    feature: 'AI chat',
    requires: ['AI_API_KEY', 'AI_API_URL'],
    optional: ['AI_MODEL'],
    keyless: false,
    note: 'Any OpenAI-compatible chat/completions endpoint; the key stays in .env.',
  }),
  Object.freeze({
    id: 'imagine',
    label: 'Image generation (.imagine)',
    feature: 'Image generation',
    requires: ['IMAGINE_API_KEY', 'IMAGINE_API_URL'],
    optional: [],
    keyless: false,
    note: 'Any OpenAI-compatible images/generations endpoint.',
  }),
  Object.freeze({
    id: 'translate',
    label: 'Translation (.translate)',
    feature: 'Translation',
    requires: [],
    optional: ['TRANSLATE_API_KEY'],
    keyless: true,
    note: 'MyMemory free tier (keyless); an email key raises the quota.',
  }),
  Object.freeze({
    id: 'weather',
    label: 'Weather (.weather)',
    feature: 'Weather',
    requires: [],
    optional: ['WEATHER_API_KEY'],
    keyless: true,
    note: 'Open-Meteo (keyless, no billing).',
  }),
  Object.freeze({
    id: 'currency',
    label: 'Currency (.currency)',
    feature: 'Currency conversion',
    requires: [],
    optional: ['CURRENCY_API_KEY'],
    keyless: true,
    note: 'Frankfurter / ECB reference rates (keyless, daily).',
  }),
  Object.freeze({
    id: 'lyrics',
    label: 'Lyrics (.lyrics)',
    feature: 'Lyrics lookup',
    requires: [],
    optional: ['LYRICS_API_KEY'],
    keyless: true,
    note: 'lyrics.ovh (keyless).',
  }),
  Object.freeze({
    id: 'shorturl',
    label: 'Short URL (.shorturl)',
    feature: 'URL shortening',
    requires: [],
    optional: ['SHORTURL_API_URL', 'SHORTURL_API_KEY'],
    keyless: true,
    note: 'is.gd by default; point SHORTURL_API_URL at your own service to override.',
  }),
  Object.freeze({
    id: 'screenshot',
    label: 'Screenshot (.screenshot)',
    feature: 'Page screenshots',
    requires: ['SCREENSHOT_API_URL'],
    optional: ['SCREENSHOT_API_KEY'],
    keyless: false,
    note: 'URL template containing {url}; private/internal targets stay blocked (SSRF guard).',
  }),
  Object.freeze({
    id: 'media',
    label: 'Media downloads (.play/.song/.video/.tiktok/.instagram)',
    feature: 'Media downloads',
    requires: ['MEDIA_API_URL'],
    optional: ['MEDIA_API_KEY'],
    keyless: false,
    note: 'Needs a licensed provider you are allowed to download from — none is bundled, and nothing is faked.',
  }),
]);

export const PROVIDER_IDS = Object.freeze(PROVIDERS.map((p) => p.id));

function isSet(env, key) {
  return String(env?.[key] ?? '').trim().length > 0;
}

/**
 * Configuration state of one provider.
 * @returns {{ id: string, label: string, feature: string, configured: boolean,
 *   keyless: boolean, hint: string, missing: string[], optional: string[],
 *   note: string, overridden: string[] }}
 */
export function providerState(provider, env = {}) {
  const missing = provider.requires.filter((k) => !isSet(env, k));
  const overridden = [...provider.requires, ...provider.optional].filter((k) => isSet(env, k));
  const configured = provider.keyless || missing.length === 0;
  return {
    id: provider.id,
    label: provider.label,
    feature: provider.feature,
    configured,
    keyless: provider.keyless,
    missing,
    optional: provider.optional,
    note: provider.note,
    overridden,
    hint: configured
      ? provider.keyless
        ? 'ready (no configuration needed)'
        : 'configured'
      : `set ${missing.join(' + ')} in .env`,
  };
}

/** @returns {ReturnType<typeof providerState>[]} one entry per provider */
export function providerStatus(env = {}) {
  return PROVIDERS.map((p) => providerState(p, env));
}

/** @returns {ReturnType<typeof providerState>[]} providers that need configuring */
export function unconfiguredProviders(env = {}) {
  return providerStatus(env).filter((p) => !p.configured);
}

/** Look up a single provider definition by id. */
export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}
