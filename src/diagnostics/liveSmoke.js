/**
 * Live smoke test engine (used by `scripts/live-smoke.mjs`).
 *
 * This is the gate named in `docs/LIMITATIONS.md`: the Baileys adapter cannot
 * be validated without a real WhatsApp account, so this harness observes real
 * events (QR emitted, connection open, inbound message, command reply, group
 * metadata) and reports ONLY what it actually saw.
 *
 * Rules enforced by the engine itself:
 *   - a step can only be marked `passed` together with observed evidence;
 *   - anything not observed is reported `not-observed`, never assumed;
 *   - optional steps that were not requested are `skipped`, not `passed`.
 *
 * The engine is pure bookkeeping (no I/O), so it is fully unit-testable; the
 * script wires the real socket into it.
 */

export const STEP_STATES = Object.freeze({
  PENDING: 'pending',
  PASSED: 'passed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  NOT_OBSERVED: 'not-observed',
});

const ICON = {
  pending: '…',
  passed: '✅',
  failed: '❌',
  skipped: '⏭️',
  'not-observed': '👁️',
};

export function createSmokeRun({ now = () => Date.now(), title = 'Xyvera MD — live smoke test' } = {}) {
  const startedAt = now();
  const steps = new Map();
  const observations = new Map(); // kind -> array of { at, payload }
  const waiters = new Map(); // kind -> Set of resolve fns

  function declareStep(id, { title: stepTitle, optional = false, required = !optional } = {}) {
    steps.set(id, {
      id,
      title: stepTitle ?? id,
      optional,
      required,
      state: STEP_STATES.PENDING,
      detail: '',
      evidence: null,
      startedAt: null,
      finishedAt: null,
    });
    return steps.get(id);
  }

  function get(id) {
    if (!steps.has(id)) declareStep(id, {});
    return steps.get(id);
  }

  function startStep(id) {
    const step = get(id);
    step.startedAt = now();
    return step;
  }

  function finish(id, state, detail, evidence = null) {
    const step = get(id);
    step.state = state;
    step.detail = String(detail ?? '');
    step.evidence = evidence;
    step.finishedAt = now();
    return step;
  }

  /** Mark a step passed — requires real evidence (engine invariant). */
  function pass(id, detail, evidence) {
    const hasEvidence =
      evidence !== null &&
      evidence !== undefined &&
      !(typeof evidence === 'object' && !Array.isArray(evidence) && Object.keys(evidence).length === 0);
    if (!hasEvidence) {
      return finish(
        id,
        STEP_STATES.FAILED,
        `${detail ? `${detail} — ` : ''}harness invariant violated: a step cannot pass without evidence`,
        null,
      );
    }
    return finish(id, STEP_STATES.PASSED, detail, evidence);
  }

  function fail(id, detail, evidence = null) {
    return finish(id, STEP_STATES.FAILED, detail, evidence);
  }

  function skip(id, reason) {
    return finish(id, STEP_STATES.SKIPPED, `${reason} (not exercised — reported as skipped, not passed)`);
  }

  /** Record an observation from the live socket and wake any waiter. */
  function mark(kind, payload = {}) {
    const at = now();
    const entry = { at, payload };
    if (!observations.has(kind)) observations.set(kind, []);
    observations.get(kind).push(entry);
    const set = waiters.get(kind);
    if (set) {
      for (const resolve of set) resolve(entry);
      waiters.delete(kind);
    }
    return entry;
  }

  function firstObservation(kind) {
    return observations.get(kind)?.[0] ?? null;
  }

  function allObservations(kind) {
    return [...(observations.get(kind) ?? [])];
  }

  /** Wait for the first observation of `kind`; resolves null on timeout. */
  function waitFor(kind, { timeoutMs = 60_000 } = {}) {
    const existing = firstObservation(kind);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      if (!waiters.has(kind)) waiters.set(kind, new Set());
      const set = waiters.get(kind);
      const done = (value) => {
        clearTimeout(timer);
        set.delete(resolve);
        resolve(value);
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      set.add(done);
    });
  }

  /**
   * Wait for an observation of `kind` recorded at or after timestamp `at`.
   * Used to prove causality (e.g. a reply that follows the observed command)
   * instead of matching an unrelated earlier event.
   */
  function waitForAfter(kind, at, { timeoutMs = 60_000, pollMs = 25 } = {}) {
    const find = () => allObservations(kind).find((o) => o.at >= at);
    const existing = find();
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const hit = find();
        if (hit) {
          clearInterval(interval);
          clearTimeout(timer);
          resolve(hit);
        }
      }, pollMs);
      const timer = setTimeout(() => {
        clearInterval(interval);
        resolve(null);
      }, timeoutMs);
    });
  }

  function build({ extra = {} } = {}) {
    const finishedAt = now();
    const list = [...steps.values()].map((s) => {
      const state = s.state === STEP_STATES.PENDING ? STEP_STATES.NOT_OBSERVED : s.state;
      return { ...s, state };
    });
    const summary = {
      passed: list.filter((s) => s.state === STEP_STATES.PASSED).length,
      failed: list.filter((s) => s.state === STEP_STATES.FAILED).length,
      skipped: list.filter((s) => s.state === STEP_STATES.SKIPPED).length,
      notObserved: list.filter((s) => s.state === STEP_STATES.NOT_OBSERVED).length,
    };
    const blocking = list.filter(
      (s) => s.required && (s.state === STEP_STATES.FAILED || s.state === STEP_STATES.NOT_OBSERVED),
    );
    summary.ok = blocking.length === 0;
    return {
      kind: 'live-smoke',
      title,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - startedAt,
      summary,
      blocking: blocking.map((s) => s.id),
      steps: list,
      ...extra,
    };
  }

  return {
    declareStep,
    startStep,
    pass,
    fail,
    skip,
    mark,
    firstObservation,
    allObservations,
    waitFor,
    waitForAfter,
    build,
    get stepCount() {
      return steps.size;
    },
  };
}

/** Exit code contract: 0 only when every required step was observed passing. */
export function smokeExitCode(report) {
  return report?.summary?.ok ? 0 : 1;
}

export function renderSmokeReport(report) {
  const lines = [];
  lines.push(report.title ?? 'Xyvera MD — live smoke test');
  lines.push(`started: ${report.startedAt} | finished: ${report.finishedAt} | ${Math.round(report.durationMs / 1000)}s`);
  if (report.botJid) lines.push(`connected as: ${report.botJid}`);
  lines.push('');
  for (const s of report.steps) {
    const mark = ICON[s.state] ?? '•';
    const opt = s.optional ? ' (optional)' : '';
    lines.push(`${mark} ${s.title}${opt}: ${s.detail || s.state}`);
  }
  lines.push('');
  const s = report.summary;
  lines.push(
    `Result: ${s.ok ? 'PASSED' : 'NOT PASSED'} — ${s.passed} passed, ${s.failed} failed, ` +
      `${s.skipped} skipped, ${s.notObserved} not observed`,
  );
  if (!s.ok) {
    lines.push('Unproven here (do not treat as verified): ' + report.blocking.join(', '));
  }
  return lines.join('\n');
}

/**
 * Drive a live smoke run against injected connection primitives.
 *
 * @param {object} opts
 * @param {ReturnType<typeof createSmokeRun>} opts.run
 * @param {(hooks: object) => Promise<object>} opts.attach
 *        Connects to WhatsApp. Receives `{ onQr, onConnected, onInbound, onOutbound, onClosed }`.
 *        Must resolve to `{ wasPaired, botJid, sendText, groupMetadata, sessionDir, stop }`.
 * @param {number} [opts.timeoutMs]      wait budget for connection/inbound/reply steps
 * @param {number} [opts.qrTimeoutMs]    wait budget for the QR step (unpaired sessions only)
 * @param {string|null} [opts.toJid]     optional self-send target (proves outbound socket)
 * @param {string|null} [opts.groupJid]  optional group whose metadata is fetched (proves group APIs)
 * @param {string|null} [opts.qrFile]    path of the QR image written for headless pairing
 */
export async function runLiveSmoke({
  run = createSmokeRun(),
  attach,
  timeoutMs = 90_000,
  qrTimeoutMs = 60_000,
  toJid = null,
  groupJid = null,
  qrFile = null,
} = {}) {
  if (typeof attach !== 'function') throw new TypeError('runLiveSmoke requires an attach() function');

  run.declareStep('connect', { title: 'Connect to WhatsApp' });
  run.declareStep('qr', { title: 'QR pairing available' });
  run.declareStep('inbound', { title: 'Inbound message observed' });
  run.declareStep('reply', { title: 'Command reply observed' });
  run.declareStep('outbound', { title: 'Outbound self-send', optional: !toJid });
  run.declareStep('group-metadata', { title: 'Group metadata fetch', optional: !groupJid });
  run.declareStep('shutdown', { title: 'Clean shutdown' });

  let api = null;
  run.startStep('connect');
  try {
    api = await attach({
      onQr: (payload) => run.mark('qr', payload),
      onConnected: (payload) => run.mark('connected', payload),
      onInbound: (payload) => run.mark('inbound', payload),
      onOutbound: (payload) => run.mark('outbound', payload),
      onClosed: (payload) => run.mark('closed', payload),
    });
  } catch (err) {
    run.fail('connect', `connection failed: ${String(err?.message ?? err)}`);
    run.skip('qr', 'connection never started');
    run.skip('inbound', 'not connected');
    run.skip('reply', 'not connected');
    run.skip('outbound', toJid ? 'not connected' : 'no --to target given');
    run.skip('group-metadata', groupJid ? 'not connected' : 'no --group given');
    run.skip('shutdown', 'nothing to shut down');
    return run.build({ extra: { qrFile, toJid, groupJid } });
  }

  const wasPaired = api.wasPaired ?? false;

  // ── connect step: a stored session is not a guarantee — the socket must
  // actually reach 'open', so we always wait for the observed event. ─────
  const connectBudget = wasPaired ? timeoutMs : qrTimeoutMs + timeoutMs;
  const connected = await run.waitFor('connected', { timeoutMs: connectBudget });
  const connectedOk = !!connected;
  if (connected) {
    run.pass(
      'connect',
      wasPaired ? 'connection opened with the stored session' : 'connection opened after pairing',
      { botJid: connected.payload?.botJid ?? api.botJid ?? null, pairedSession: wasPaired },
    );
  } else {
    const closed = run.firstObservation('closed');
    run.fail(
      'connect',
      `no connection within ${Math.round(connectBudget / 1000)}s` +
        (closed ? ` (socket closed first: ${JSON.stringify(closed.payload ?? {})})` : ''),
      closed ? { closed: closed.payload ?? null } : null,
    );
  }

  // ── QR step ──────────────────────────────────────────────────────────
  if (wasPaired) {
    run.skip('qr', 'session already paired — no QR is requested by WhatsApp');
  } else {
    const qr = await run.waitFor('qr', { timeoutMs: qrTimeoutMs });
    if (qr) {
      run.pass('qr', 'WhatsApp requested pairing; a QR was emitted and saved for headless scanning', {
        emittedAt: new Date(qr.at).toISOString(),
        qrFile: qrFile ?? null,
        savedToFile: qr.payload?.savedToFile ?? null,
      });
    } else {
      run.fail('qr', `no QR emitted within ${Math.round(qrTimeoutMs / 1000)}s`);
    }
  }

  if (!connectedOk) {
    // Nothing downstream can be observed without a live socket.
    run.skip('inbound', 'the connection never opened');
    run.skip('reply', 'the connection never opened');
    run.skip('outbound', toJid ? 'the connection never opened' : 'no --to target given');
    run.skip('group-metadata', groupJid ? 'the connection never opened' : 'no --group given');
  } else {
    // ── inbound step ───────────────────────────────────────────────────
    const inbound = await run.waitFor('inbound', { timeoutMs });
    if (inbound) {
      const p = inbound.payload ?? {};
      run.pass('inbound', 'a real message was received and normalized by the adapter', {
        chat: p.chatJid ?? null,
        isGroup: !!p.isGroup,
        hasText: !!p.hasText,
        textLength: p.textLength ?? 0,
        fromMe: !!p.fromMe,
      });
    } else {
      run.fail('inbound', `no inbound message within ${Math.round(timeoutMs / 1000)}s (send one with WhatsApp)`);
    }

    // ── reply step: the reply must be observed AFTER the command ────────
    if (inbound?.payload?.hadPrefix) {
      const reply = await run.waitForAfter('outbound', inbound.at, { timeoutMs });
      if (reply) {
        run.pass('reply', 'the bot produced a reply through the live socket after the command', {
          target: reply.payload?.jid ?? null,
          textLength: reply.payload?.textLength ?? 0,
          replyDelayMs: reply.at - inbound.at,
        });
      } else {
        run.fail('reply', `no outbound reply observed within ${Math.round(timeoutMs / 1000)}s of the command`);
      }
    } else if (inbound) {
      run.fail('reply', 'the observed message did not start with the command prefix, so the router path was not exercised');
    } else {
      run.skip('reply', 'no inbound message to reply to');
    }

    // ── optional self-send ─────────────────────────────────────────────
    if (toJid) {
      try {
        await api.sendText?.(toJid, 'Xyvera MD live smoke test — outbound socket check');
        run.pass('outbound', 'the live socket accepted the send call (delivery itself is not asserted)', {
          to: toJid,
          acceptedAt: new Date().toISOString(),
        });
      } catch (err) {
        run.fail('outbound', `send failed: ${String(err?.message ?? err)}`, { to: toJid });
      }
    } else {
      run.skip('outbound', 'no --to target given');
    }

    // ── optional group metadata ────────────────────────────────────────
    if (groupJid) {
      try {
        const meta = await api.groupMetadata?.(groupJid);
        if (!meta) throw new Error('no metadata returned (is the bot in that group?)');
        run.pass('group-metadata', 'group APIs answered with real metadata', {
          group: groupJid,
          subject: meta.subject ?? null,
          participants: Array.isArray(meta.participants) ? meta.participants.length : null,
        });
      } catch (err) {
        run.fail('group-metadata', `group metadata failed: ${String(err?.message ?? err)}`, { group: groupJid });
      }
    } else {
      run.skip('group-metadata', 'no --group given');
    }
  }

  // ── shutdown ─────────────────────────────────────────────────────────
  try {
    await api.stop?.();
    run.pass('shutdown', 'socket closed cleanly', { closedAt: new Date().toISOString() });
  } catch (err) {
    run.fail('shutdown', `shutdown failed: ${String(err?.message ?? err)}`);
  }

  return run.build({ extra: { qrFile, toJid, groupJid } });
}
