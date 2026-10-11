#!/usr/bin/env node
/**
 * Xyvera MD — bootstrap.
 *
 * Wires config → storage → services → command registry → router → WhatsApp.
 * Run `node src/index.js --check` to initialize everything WITHOUT connecting
 * (useful on CI and before configuring a WhatsApp account).
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promises as fs } from 'node:fs';

import { loadEnv } from './config/env.js';
import { defaultSettings, BOT_DEFAULTS, SCHEMA_VERSION } from './config/defaults.js';
import { createLogger } from './utils/logger.js';
import { CooldownStore } from './utils/cooldowns.js';
import { Store } from './storage/jsonStore.js';
import { PermissionService } from './whatsapp/permissions.js';
import { WarningService, ModerationService } from './services/moderation.js';
import { ConfirmationService } from './services/confirmations.js';
import { StatusAutomationService } from './services/statusAutomation.js';
import { GameRegistry } from './services/gameEngine.js';
import { ReminderService } from './services/reminders.js';
import { createProviders } from './services/providers.js';
import { renderTemplate } from './utils/templates.js';
import { CommandRegistry } from './commands/registry.js';
import { CommandRouter } from './commands/router.js';
import { validatePrefix } from './utils/validators.js';

import registerInfoCommands from './commands/info/index.js';
import registerOwnerCommands from './commands/owner/index.js';
import registerGroupCommands from './commands/group/index.js';
import registerSecurityCommands from './commands/security/index.js';
import registerAutomationCommands from './commands/automation/index.js';
import registerGameCommands from './commands/games/index.js';
import registerAiCommands from './commands/ai/index.js';
import registerUtilityCommands from './commands/utilities/index.js';

export async function bootstrap({ rootDir = process.cwd(), connect = true, env: envOverride = {} } = {}) {
  const env = loadEnv({ rootDir, env: { ...process.env, ...envOverride } });
  const logger = createLogger({ level: env.LOG_LEVEL });

  // ── storage ──────────────────────────────────────────────────────────
  const dataDir = path.resolve(rootDir, env.DATA_DIR);
  const tmpDir = path.resolve(rootDir, env.TMP_DIR);
  await fs.mkdir(tmpDir, { recursive: true });

  const store = new Store({ dataDir, logger });
  store.setSettingsDefaults(() => ({
    ...defaultSettings(),
    botName: env.BOT_NAME,
    displayName: env.BOT_DISPLAY_NAME,
    version: env.BOT_VERSION,
    prefix: env.BOT_PREFIX,
    mode: env.BOT_MODE,
    ownerName: env.OWNER_NAME,
    ownerNumbers: env.OWNER_NUMBERS,
    githubUrl: env.GITHUB_URL,
    projectUrl: env.PROJECT_URL,
  }));
  await store.init();

  // Persist owner numbers from env on every boot (env is source of truth until
  // a settings UI exists); never guess a number that is not configured.
  store.settings.update((s) => {
    const numbers = env.OWNER_NUMBERS.map((n) => `${n}@s.whatsapp.net`);
    const merged = [...new Set([...(s.ownerNumbers ?? []), ...numbers])];
    return { ...s, ownerNumbers: merged, ownerName: env.OWNER_NAME || s.ownerName };
  });

  // Validate prefix persisted in settings
  try {
    validatePrefix(store.settings.get().prefix);
  } catch {
    logger.warn?.('invalid stored prefix — resetting to default');
    store.settings.update((s) => ({ ...s, prefix: BOT_DEFAULTS.prefix }));
  }

  // ── services ─────────────────────────────────────────────────────────
  const permissions = new PermissionService({
    settings: store.settings,
    isGroupAdminFn: async (chatJid, userJid) => {
      if (!waClient) return false;
      return waClient.isGroupAdmin(chatJid, userJid);
    },
  });
  const warnings = new WarningService({ warningsDoc: store.warnings });
  const moderation = new ModerationService({ groupsRepo: store.groups, warnings, logger });
  const confirmations = new ConfirmationService();
  const statusAutomation = new StatusAutomationService({ statusDoc: store.status, logger });
  const cooldowns = new CooldownStore();
  const gameRegistry = new GameRegistry();
  const providers = createProviders({ env });
  const reminders = new ReminderService({
    doc: store.reminders,
    sendFn: async (chatJid, userJid, text) => {
      if (!waClient) return;
      await waClient.sendText(chatJid, `⏰ Reminder for @${String(userJid).split('@')[0]}: ${text}`, {
        mentions: [userJid],
      });
    },
    logger,
  });

  const getConfig = () => ({
    ...store.settings.get(),
    prefix: store.settings.get().prefix,
    version: store.settings.get().version || env.BOT_VERSION,
    ownerName: store.settings.get().ownerName || env.OWNER_NAME,
  });
  const updateSettings = (mutator) => store.settings.update(mutator);

  // ── command registry ─────────────────────────────────────────────────
  const registry = new CommandRegistry();
  const deps = {
    getConfig,
    updateSettings,
    tmpDir,
    sessionDir: store.sessionDir,
    getEnv: () => env,
    gameRegistry,
    getProviders: () => providers,
  };
  registerInfoCommands(registry, deps);
  registerOwnerCommands(registry, deps);
  registerGroupCommands(registry, deps);
  registerSecurityCommands(registry, deps);
  registerAutomationCommands(registry, deps);
  registerGameCommands(registry, deps);
  registerAiCommands(registry, deps);
  registerUtilityCommands(registry, deps);

  const router = new CommandRouter({
    registry,
    permissions,
    cooldowns,
    confirmations,
    logger,
    getPrefix: () => store.settings.get().prefix ?? '.',
    botJid: () => waBotJid,
  });

  const services = {
    registry,
    warnings,
    moderation,
    statusAutomation,
    confirmations,
    gameRegistry,
    reminders,
    providers,
    groupsRepo: store.groups,
    renderTemplate,
    config: getConfig(),
    updateSettings,
    env,
  };

  let waClient = null;
  let waBotJid = null;

  const app = {
    env,
    logger,
    store,
    permissions,
    warnings,
    moderation,
    confirmations,
    statusAutomation,
    cooldowns,
    gameRegistry,
    registry,
    router,
    services,
    tmpDir,
    get client() {
      return waClient;
    },
    get botJid() {
      return waBotJid;
    },
    /** Attach a WhatsAppClient (real adapter or test fake) after init. */
    attachClient(client, botJid = null) {
      waClient = client;
      if (botJid) waBotJid = botJid;
    },
  };

  if (!connect) {
    logger.info?.(`initialized without WhatsApp connection — ${registry.size} commands registered`);
    return app;
  }

  // ── WhatsApp connection (dynamic import) ─────────────────────────────
  const { connectWhatsApp } = await import('./whatsapp/connection.js');
  const { attachEventHandlers } = await import('./whatsapp/events.js');
  const { createClientAdapter } = await import('./whatsapp/client.js');

  const { sock } = await connectWhatsApp({
    env,
    logger,
    onEvent: {
      connectionOpen: (jid) => {
        waBotJid = jid;
        logger.info?.(`connected as ${jid}`);
      },
    },
  });

  waClient = createClientAdapter(sock, { logger, tmpDir });

  attachEventHandlers(sock, {
    router,
    moderation,
    statusAutomation,
    groupsRepo: store.groups,
    logger,
    client: waClient,
  });

  // Wire handler services into dispatches (router.dispatch receives services arg)
  const originalDispatch = router.dispatch.bind(router);
  router.dispatch = (msg, client, _svc) => originalDispatch(msg, client, services);

  // Re-arm persisted reminders now that a client is available.
  reminders.restore();

  logger.info?.('Xyvera MD started', { commands: registry.size, mode: permissions.getMode() });
  return app;
}

// CLI entry — runs only when this file IS the process entry point.
const entryHref = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
const isMain = entryHref === import.meta.url;
if (isMain) {
  const check = process.argv.includes('--check');
  bootstrap({ connect: !check })
    .then((app) => {
      if (check) {
        const byCat = {};
        for (const cmd of app.registry.list()) {
          byCat[cmd.category] = (byCat[cmd.category] ?? 0) + 1;
        }
        console.log(
          JSON.stringify(
            {
              ok: true,
              commands: app.registry.size,
              byCategory: byCat,
              mode: app.permissions.getMode(),
              ownersConfigured: app.permissions.ownerJids().length,
              schemaVersion: SCHEMA_VERSION,
            },
            null,
            2,
          ),
        );
      }
    })
    .catch((err) => {
      console.error('FATAL:', err?.stack ?? err);
      process.exit(1);
    });
}
