import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createProviders } from '../src/services/providers.js';
import { NotConfiguredError, ExternalServiceError } from '../src/utils/errors.js';

/** Build a mock fetch that answers by URL pattern. */
function mockFetch(handlers) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    for (const [pattern, response] of handlers) {
      if (u.includes(pattern)) {
        return {
          ok: true,
          status: 200,
          json: async () => response,
          arrayBuffer: async () => response.__bytes ?? new ArrayBuffer(8),
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  fn.calls = calls;
  return fn;
}

test('unconfigured providers raise NotConfiguredError naming the env var', async () => {
  const p = createProviders({ env: {}, fetchImpl: mockFetch([]) });
  await assert.rejects(() => p.chat('hi'), NotConfiguredError);
  await assert.rejects(() => p.imagine('hi'), NotConfiguredError);
  await assert.rejects(() => p.screenshot('https://example.com'), NotConfiguredError);
});

test('AI chat uses OpenAI-compatible endpoint and returns content', async () => {
  const f = mockFetch([
    ['chat/completions', { choices: [{ message: { content: 'Hello there!' } }] }],
  ]);
  const p = createProviders({ env: { AI_API_KEY: 'k', AI_API_URL: 'https://api.example.com/v1' }, fetchImpl: f });
  const out = await p.chat('hi');
  assert.equal(out, 'Hello there!');
  const call = f.calls[0];
  assert.ok(call.url.includes('https://api.example.com/v1/chat/completions'));
  assert.equal(call.opts.headers.authorization, 'Bearer k');
  const body = JSON.parse(call.opts.body);
  assert.equal(body.messages.at(-1).content, 'hi');
});

test('AI chat does not duplicate the endpoint path', async () => {
  const f = mockFetch([
    ['chat/completions', { choices: [{ message: { content: 'ok' } }] }],
  ]);
  const p = createProviders({ env: { AI_API_KEY: 'k', AI_API_URL: 'https://api.example.com/v1/chat/completions' }, fetchImpl: f });
  await p.chat('x');
  assert.equal(f.calls[0].url, 'https://api.example.com/v1/chat/completions');
});

test('AI chat surfaces empty responses honestly', async () => {
  const f = mockFetch([['chat/completions', { choices: [] }]]);
  const p = createProviders({ env: { AI_API_KEY: 'k', AI_API_URL: 'https://api.example.com/v1' }, fetchImpl: f });
  await assert.rejects(() => p.chat('hi'), /no content/i);
});

test('imagine returns url or buffer from compatible image APIs', async () => {
  const f1 = mockFetch([['images/generations', { data: [{ url: 'https://img.example.com/x.png' }] }]]);
  const p1 = createProviders({ env: { IMAGINE_API_KEY: 'k', IMAGINE_API_URL: 'https://api.example.com/v1' }, fetchImpl: f1 });
  assert.equal((await p1.imagine('cat')).url, 'https://img.example.com/x.png');

  const f2 = mockFetch([
    ['images/generations', { data: [{ b64_json: Buffer.from('img').toString('base64') }] }],
  ]);
  const p2 = createProviders({ env: { IMAGINE_API_KEY: 'k', IMAGINE_API_URL: 'https://api.example.com/v1' }, fetchImpl: f2 });
  assert.deepEqual((await p2.imagine('cat')).buffer, Buffer.from('img'));
});

test('translate uses MyMemory and parses translated text', async () => {
  const f = mockFetch([
    ['mymemory.translated.net', { responseData: { translatedText: 'Bonjour' }, responseStatus: 200 }],
  ]);
  const p = createProviders({ env: {}, fetchImpl: f });
  const res = await p.translate('hello', 'fr');
  assert.equal(res.translated, 'Bonjour');
  assert.ok(f.calls[0].url.includes('langpair=autodetect%7Cfr') || f.calls[0].url.includes('langpair=autodetect|fr'));
});

test('translate reports provider errors honestly', async () => {
  const f = mockFetch([
    ['mymemory.translated.net', { responseData: {}, responseStatus: 429, responseDetails: 'LIMIT EXCEEDED' }],
  ]);
  const p = createProviders({ env: {}, fetchImpl: f });
  await assert.rejects(() => p.translate('hello', 'fr'), /LIMIT EXCEEDED/);
});

test('weather geocodes then fetches current conditions', async () => {
  const f = mockFetch([
    ['geocoding-api.open-meteo.com', { results: [{ name: 'Lagos', country: 'Nigeria', latitude: 6.45, longitude: 3.4 }] }],
    ['api.open-meteo.com', {
      current: {
        temperature_2m: 30.2,
        apparent_temperature: 34.1,
        relative_humidity_2m: 77,
        wind_speed_10m: 12,
        weather_code: 2,
      },
    }],
  ]);
  const p = createProviders({ env: {}, fetchImpl: f });
  const w = await p.weather('Lagos');
  assert.equal(w.place, 'Lagos, Nigeria');
  assert.equal(w.tempC, 30.2);
  assert.equal(w.description, 'partly cloudy');
  assert.equal(f.calls.length, 2);
});

test('weather reports unknown cities honestly', async () => {
  const f = mockFetch([['geocoding-api.open-meteo.com', { results: [] }]]);
  const p = createProviders({ env: {}, fetchImpl: f });
  await assert.rejects(() => p.weather('Nowhereville'), /No place found/);
});

test('currency converts via Frankfurter and validates codes', async () => {
  const f = mockFetch([
    ['frankfurter.app', { amount: 10, base: 'USD', date: '2026-10-10', rates: { NGN: 15800 } }],
  ]);
  const p = createProviders({ env: {}, fetchImpl: f });
  const res = await p.currency(10, 'usd', 'ngn');
  assert.equal(res.converted, 15800);
  assert.equal(res.from, 'USD');
});

test('currency refuses nonsense pairs instead of inventing rates', async () => {
  const f = mockFetch([['frankfurter.app', { amount: 1, base: 'XXX', date: '2026-10-10', rates: {} }]]);
  const p = createProviders({ env: {}, fetchImpl: f });
  await assert.rejects(() => p.currency(1, 'XXX', 'YYY'), /No rate/);
});

test('lyrics returns text and handles missing songs', async () => {
  const f = mockFetch([['api.lyrics.ovh', { lyrics: 'la la la' }]]);
  const p = createProviders({ env: {}, fetchImpl: f });
  assert.equal(await p.lyrics('Artist', 'Title'), 'la la la');

  const f2 = mockFetch([['api.lyrics.ovh', {}]]);
  const p2 = createProviders({ env: {}, fetchImpl: f2 });
  await assert.rejects(() => p2.lyrics('Artist', 'Nope'), /No lyrics/);
});

test('shorten refuses private URLs (SSRF) before calling the provider', async () => {
  const f = mockFetch([['is.gd', { shorturl: 'https://is.gd/x' }]]);
  const p = createProviders({ env: {}, fetchImpl: f });
  await assert.rejects(() => p.shorten('http://127.0.0.1/evil'), /Refusing/);
  assert.equal(f.calls.length, 0);
});

test('shorten returns the provider URL and surfaces provider errors', async () => {
  const f = mockFetch([['is.gd', { shorturl: 'https://is.gd/abc' }]]);
  const p = createProviders({ env: {}, fetchImpl: f });
  assert.equal(await p.shorten('https://example.com/long'), 'https://is.gd/abc');

  const f2 = mockFetch([['is.gd', { errormessage: 'Please enter a valid URL to shorten' }]]);
  const p2 = createProviders({ env: { SHORTURL_API_URL: 'https://is.gd/create.php' }, fetchImpl: f2 });
  await assert.rejects(() => p2.shorten('https://example.com/long'), /Please enter a valid URL/);
});

test('screenshot requires a {url} template and blocks private targets', async () => {
  const f = mockFetch([['shot.example.com', { __bytes: new Uint8Array([1, 2, 3]).buffer }]]);
  const p = createProviders({ env: { SCREENSHOT_API_URL: 'https://shot.example.com/?u={url}' }, fetchImpl: f });

  await assert.rejects(() => p.screenshot('http://192.168.0.1'), /Refusing/);
  assert.equal(f.calls.length, 0);

  const buf = await p.screenshot('https://example.com/page');
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(f.calls[0].url.includes(encodeURIComponent('https://example.com/page')));

  const pBad = createProviders({ env: { SCREENSHOT_API_URL: 'https://shot.example.com/no-placeholder' }, fetchImpl: f });
  await assert.rejects(() => pBad.screenshot('https://example.com'), /placeholder/);
});

test('network failures become ExternalServiceError, never fake success', async () => {
  const f = async () => {
    throw new Error('ECONNREFUSED');
  };
  const p = createProviders({ env: { TRANSLATE_API_KEY: '' }, fetchImpl: f });
  await assert.rejects(() => p.translate('hi', 'en'), ExternalServiceError);
});
