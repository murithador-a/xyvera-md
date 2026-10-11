/**
 * Structured logger with automatic redaction of sensitive-looking fields.
 * Never log authentication tokens, session data, or API keys.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

const SENSITIVE_KEY = /(token|secret|password|passwd|api[-_]?key|auth|session|creds|credential|private)/i;

/** Recursively redact values whose keys look sensitive. */
export function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: value.code };
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}

export function createLogger({ level = 'info', pretty = true, name = 'xyvera-md', stream = process.stdout } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(lvl, msg, fields) {
    if (LEVELS[lvl] < threshold) return;
    const entry = { ts: new Date().toISOString(), level: lvl, name, msg, ...(fields ? redact(fields) : {}) };
    if (pretty) {
      const extra = { ...entry };
      delete extra.ts;
      delete extra.level;
      delete extra.name;
      delete extra.msg;
      const tail = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
      stream.write(`[${entry.ts}] ${lvl.toUpperCase().padEnd(5)} ${msg}${tail}\n`);
    } else {
      stream.write(`${JSON.stringify(entry)}\n`);
    }
  }

  return {
    level,
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    child: (bindings = {}) =>
      createLogger({ level, pretty, name: bindings.name ?? name, stream }),
  };
}
