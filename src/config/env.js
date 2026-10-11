/**
 * Environment configuration loader (tiny .env parser, no dependency).
 * Secrets are read here and never logged or written into persisted config.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BOT_DEFAULTS } from './defaults.js';

/** Parse .env-format text into a flat object. */
export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Load config: .env file (if present) overlaid by process.env.
 * @param {{ rootDir?: string, env?: object }} opts
 */
export function loadEnv({ rootDir = process.cwd(), env = process.env } = {}) {
  let fileValues = {};
  try {
    fileValues = parseEnvFile(readFileSync(path.join(rootDir, '.env'), 'utf8'));
  } catch {
    /* no .env — fine */
  }

  const merged = { ...fileValues };
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) merged[k] = v;
  }

  const pick = (key, fallback = '') => (merged[key] ?? fallback).toString().trim();

  return {
    BOT_NAME: pick('BOT_NAME', BOT_DEFAULTS.name),
    BOT_DISPLAY_NAME: pick('BOT_DISPLAY_NAME', BOT_DEFAULTS.name),
    BOT_VERSION: pick('BOT_VERSION', BOT_DEFAULTS.version),
    BOT_PREFIX: pick('BOT_PREFIX', BOT_DEFAULTS.prefix),
    OWNER_NUMBERS: pick('OWNER_NUMBERS')
      .split(',')
      .map((s) => s.replace(/[^\d]/g, ''))
      .filter(Boolean),
    OWNER_NAME: pick('OWNER_NAME', BOT_DEFAULTS.ownerName),
    GITHUB_URL: pick('GITHUB_URL') || null,
    PROJECT_URL: pick('PROJECT_URL') || null,
    BOT_MODE: pick('BOT_MODE', BOT_DEFAULTS.mode),
    LOG_LEVEL: pick('LOG_LEVEL', 'info'),
    TMP_DIR: pick('TMP_DIR', 'tmp'),
    DATA_DIR: pick('DATA_DIR', 'data'),
    // External providers (empty string = not configured)
    AI_API_KEY: pick('AI_API_KEY'),
    AI_API_URL: pick('AI_API_URL'),
    AI_MODEL: pick('AI_MODEL'),
    IMAGINE_API_KEY: pick('IMAGINE_API_KEY'),
    IMAGINE_API_URL: pick('IMAGINE_API_URL'),
    TRANSLATE_API_KEY: pick('TRANSLATE_API_KEY'),
    WEATHER_API_KEY: pick('WEATHER_API_KEY'),
    CURRENCY_API_KEY: pick('CURRENCY_API_KEY'),
    SHORTURL_API_URL: pick('SHORTURL_API_URL'),
    SHORTURL_API_KEY: pick('SHORTURL_API_KEY'),
    SCREENSHOT_API_URL: pick('SCREENSHOT_API_URL'),
    SCREENSHOT_API_KEY: pick('SCREENSHOT_API_KEY'),
    LYRICS_API_KEY: pick('LYRICS_API_KEY'),
    MEDIA_API_URL: pick('MEDIA_API_URL'),
    MEDIA_API_KEY: pick('MEDIA_API_KEY'),
  };
}
