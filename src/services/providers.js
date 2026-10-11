/**
 * External provider adapters.
 *
 * Policy (docs/ARCHITECTURE.md §11): every integration is documented,
 * env-configured, mockable (injectable fetch), and returns clear setup errors
 * when unconfigured — never a fake success.
 *
 * Providers implemented here (documented choices):
 *  - AI chat / imagine : any OpenAI-compatible endpoint (AI_API_URL/IMAGINE_API_URL + keys)
 *  - translate         : MyMemory (free tier; key optional)
 *  - weather           : Open-Meteo (keyless, non-commercial-friendly, no billing)
 *  - currency          : Frankfurter (keyless, ECB reference rates)
 *  - lyrics            : lyrics.ovh (keyless)
 *  - shorturl          : is.gd / v.gd JSON API (keyless; overridable)
 *  - screenshot        : configurable screenshot service URL template ({url} placeholder)
 * Media download providers (.play/.song/.video/.tiktok/.instagram) are NOT
 * implemented: no legitimate universal provider exists without a commercial
 * deal — those commands keep returning setup guidance.
 */

import { NotConfiguredError, ExternalServiceError } from '../utils/errors.js';
import { isSafePublicUrl } from '../utils/validators.js';

const TIMEOUT_MS = 20_000;

async function httpJson(fetchImpl, url, opts = {}) {
  let res;
  try {
    res = await fetchImpl(url, {
      ...opts,
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (err) {
    throw new ExternalServiceError(`Provider request failed: ${String(err?.message ?? err)}`);
  }
  if (!res.ok) {
    throw new ExternalServiceError(`Provider returned HTTP ${res.status}.`);
  }
  return res.json();
}

export function createProviders({ env, fetchImpl = null } = {}) {
  const f = fetchImpl ?? ((...args) => fetch(...args));
  const e = (k) => String(env?.[k] ?? '').trim();

  return {
    /** OpenAI-compatible chat completions. */
    async chat(prompt, { system = null, maxTokens = 800 } = {}) {
      const key = e('AI_API_KEY');
      const base = e('AI_API_URL');
      if (!key || !base) throw new NotConfiguredError('.ai', 'AI_API_KEY + AI_API_URL');
      const model = e('AI_MODEL') || 'gpt-4o-mini';
      const endpoint = base.includes('chat/completions') ? base : `${base.replace(/\/$/, '')}/chat/completions`;
      const body = {
        model,
        max_tokens: maxTokens,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: prompt },
        ],
      };
      const data = await httpJson(f, endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new ExternalServiceError('AI provider returned no content.');
      return String(text);
    },

    /** OpenAI-compatible image generation. Returns a URL or base64 PNG. */
    async imagine(prompt) {
      const key = e('IMAGINE_API_KEY');
      const base = e('IMAGINE_API_URL');
      if (!key || !base) throw new NotConfiguredError('.imagine', 'IMAGINE_API_KEY + IMAGINE_API_URL');
      const endpoint = base.includes('images/generations') ? base : `${base.replace(/\/$/, '')}/images/generations`;
      const data = await httpJson(f, endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ prompt, n: 1, size: '1024x1024' }),
      });
      const item = data?.data?.[0];
      if (item?.b64_json) return { buffer: Buffer.from(item.b64_json, 'base64') };
      if (item?.url) return { url: item.url };
      throw new ExternalServiceError('Image provider returned no image.');
    },

    /** MyMemory translation (https://mymemory.translated.net). */
    async translate(text, toLang = 'en', fromLang = 'autodetect') {
      const url = new URL('https://api.mymemory.translated.net/get');
      url.searchParams.set('q', text.slice(0, 500));
      url.searchParams.set('langpair', `${fromLang}|${toLang}`);
      const key = e('TRANSLATE_API_KEY');
      if (key) url.searchParams.set('key', key);
      const data = await httpJson(f, url);
      const translated = data?.responseData?.translatedText;
      if (!translated || data?.responseStatus >= 400) {
        throw new ExternalServiceError(
          `Translation failed: ${data?.responseDetails ?? `status ${data?.responseStatus}`}`,
        );
      }
      return { translated: String(translated), engine: 'MyMemory' };
    },

    /** Open-Meteo weather (keyless). */
    async weather(city) {
      const geoUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
      geoUrl.searchParams.set('name', city);
      geoUrl.searchParams.set('count', '1');
      const geo = await httpJson(f, geoUrl);
      const place = geo?.results?.[0];
      if (!place) throw new ExternalServiceError(`No place found matching "${city}".`);
      const wxUrl = new URL('https://api.open-meteo.com/v1/forecast');
      wxUrl.searchParams.set('latitude', String(place.latitude));
      wxUrl.searchParams.set('longitude', String(place.longitude));
      wxUrl.searchParams.set(
        'current',
        'temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code',
      );
      const wx = await httpJson(f, wxUrl);
      const c = wx?.current;
      if (!c) throw new ExternalServiceError('Weather provider returned no current conditions.');
      return {
        place: `${place.name}${place.country ? `, ${place.country}` : ''}`,
        tempC: c.temperature_2m,
        feelsLikeC: c.apparent_temperature,
        humidity: c.relative_humidity_2m,
        windKmh: c.wind_speed_10m,
        description: weatherCodeText(c.weather_code),
        engine: 'Open-Meteo',
      };
    },

    /** Frankfurter currency conversion (keyless, ECB daily rates). */
    async currency(amount, from, to) {
      const fromC = String(from).toUpperCase();
      const toC = String(to).toUpperCase();
      const url = new URL('https://api.frankfurter.app/latest');
      url.searchParams.set('amount', String(amount));
      url.searchParams.set('from', fromC);
      url.searchParams.set('to', toC);
      const data = await httpJson(f, url);
      const rate = data?.rates?.[toC];
      if (rate === undefined) {
        throw new ExternalServiceError(`No rate for ${fromC}→${toC} (check the currency codes; ECB rates exclude some pegged currencies).`);
      }
      return { converted: rate, from: fromC, to: toC, amount: Number(amount), date: data?.date, engine: 'Frankfurter/ECB' };
    },

    /** lyrics.ovh (keyless). */
    async lyrics(artist, title) {
      const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
      const data = await httpJson(f, url);
      const text = data?.lyrics;
      if (!text) throw new ExternalServiceError('No lyrics found for that track.');
      return String(text).trim();
    },

    /** is.gd JSON API (keyless) — configurable via SHORTURL_API_URL. */
    async shorten(url) {
      const check = isSafePublicUrl(url);
      if (!check.ok) throw new ExternalServiceError(`Refusing to shorten: ${check.reason}`);
      const apiBase = e('SHORTURL_API_URL') || 'https://is.gd/create.php';
      const target = new URL(apiBase);
      target.searchParams.set('format', 'json');
      target.searchParams.set('url', check.url.toString());
      const data = await httpJson(f, target);
      const short = data?.shorturl;
      if (!short) throw new ExternalServiceError(data?.errormessage ? `Provider said: ${data.errormessage}` : 'Provider returned no short URL.');
      return String(short);
    },

    /**
     * Screenshot via a configured service URL template containing {url}.
     * SSRF-safe: the target URL is validated first (no private/local hosts).
     */
    async screenshot(url) {
      const check = isSafePublicUrl(url);
      if (!check.ok) throw new ExternalServiceError(`Refusing to screenshot: ${check.reason}`);
      const template = e('SCREENSHOT_API_URL');
      if (!template) throw new NotConfiguredError('.screenshot', 'SCREENSHOT_API_URL');
      if (!template.includes('{url}')) {
        throw new ExternalServiceError('SCREENSHOT_API_URL must contain a {url} placeholder.');
      }
      const finalUrl = template.replace('{url}', encodeURIComponent(check.url.toString()));
      const key = e('SCREENSHOT_API_KEY');
      let res;
      try {
        res = await f(finalUrl, {
          headers: key ? { authorization: `Bearer ${key}` } : {},
          signal: AbortSignal.timeout(TIMEOUT_MS * 2),
        });
      } catch (err) {
        throw new ExternalServiceError(`Screenshot request failed: ${String(err?.message ?? err)}`);
      }
      if (!res.ok) throw new ExternalServiceError(`Screenshot service returned HTTP ${res.status}.`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new ExternalServiceError('Screenshot service returned an empty image.');
      return buf;
    },
  };
}

function weatherCodeText(code) {
  const table = {
    0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
    45: 'fog', 48: 'rime fog', 51: 'light drizzle', 53: 'drizzle', 55: 'dense drizzle',
    61: 'light rain', 63: 'rain', 65: 'heavy rain', 71: 'light snow', 73: 'snow',
    75: 'heavy snow', 80: 'rain showers', 81: 'rain showers', 82: 'violent showers',
    95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail',
  };
  return table[code] ?? `weather code ${code}`;
}
