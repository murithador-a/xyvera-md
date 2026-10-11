# Xyvera MD — Limitations

Honest accounting of what this bot cannot do, or does only partially. Nothing
here is a "hidden" failure mode — commands report these limits in-chat too.

## Platform / library limits (WhatsApp + Baileys)

- **Unofficial API.** Baileys drives WhatsApp Web. WhatsApp does not endorse
  automation and may rate-limit, restrict, or ban accounts that violate its
  Terms of Service. Use the bot fairly and at modest volume.
- **7.x is a release-candidate line.** `baileys@7.0.0-rc14` is current `latest`
  on npm with breaking changes vs 6.x (migration guide: whiskey.so/migrate-latest).
  All Baileys usage is isolated in `src/whatsapp/` so API churn is contained.
- **No native slow-mode API.** Baileys exposes no group slow-mode call, so
  `.slowmode` reports "unsupported by the library" and does **not** pretend that
  bot-side command cooldowns are WhatsApp-native message throttling.
- **Leave vs kick is not always distinguishable.** `group-participants.update`
  does not reliably say whether a member left voluntarily or was removed;
  goodbye messages never claim either.
- **Direct `.add` often fails by design.** WhatsApp privacy settings usually
  force invitations instead; the bot explains this and falls back to the invite
  link workflow.
- **`.setbotpp` / welcome media.** Profile-picture changes and greeting media
  need the media pipeline (phase 2). The commands report this instead of
  pretending success.
- **Status events.** Statuses arrive as `status@broadcast` messages. Auto-view /
  auto-react work only on statuses the bot actually receives, are rate-limited
  and deduplicated, and delivery/reaction confirmations are never fabricated.
- **Anti-delete can only recover what the bot saw.** Revoked messages are
  recoverable only if the bot received them and retained a snapshot (memory
  only, capped per group). Content the bot never received cannot be recovered.
- **Bot self is owner-equivalent.** The connected WhatsApp account can run
  owner commands (it is the authenticated device). Protect the session.
- **LID/phone identity mapping.** Identity checks use canonical JIDs from the
  transport layer. If WhatsApp delivers opaque `@lid` identifiers for a
  participant, sudo/owner matching for that user may not resolve until a
  phone-number mapping is available. This is being watched in `normalize.js`.

## Privacy and policy boundaries (by design)

- **No view-once bypass (`.vv`/`.vv2`).** These commands exist only to explain
  the policy. Xyvera MD will not reveal view-once media.
- **No anti-call** in the initial release.
- **No `.autotyping` / `.autorecording`** in the initial release.
- **No gambling or wagers** in any game.
- **`.ban`/`.unban` never kick or block.** They only gate bot command access.
- **`.ghost` and "Dazzle" are undefined** — they reply `pending-definition`
  until their behavior is specified (REQUIREMENTS §3).
- **`.password` generates random passwords** and never reads saved credentials.

## External services

- AI, imagine, translate, weather, currency, short URL, screenshot, lyrics, and
  media downloads require a configured provider in `.env`. Without one, the
  commands return setup instructions — never a fake success. The provider
  adapters themselves land in a later phase (see COMMANDS.md statuses).
- `.shorturl` will never invent a shortened URL; `.screenshot` will always
  block private/internal/local targets (SSRF guard in `utils/validators.js`).

## Storage / runtime

- JSON persistence is per-file with atomic writes and corruption quarantine,
  but it is single-process. Do not run two bot instances against the same
  `data/` directory.
- `.reminder` is in-memory: reminders do not survive a restart.
- Warning/escalation kicks require human `.confirm` (safety rail) until the
  group has explicitly configured `warnings.actionOnThreshold = kick`; even
  then, the current implementation asks for confirmation before removing a
  member. (REQUIREMENTS §3.6.)
- Game state is in-memory: active games do not survive a restart.

## Test honesty

- 132 automated tests cover business logic, permissions, and persistence using
  mocked WhatsApp operations (`tests/helpers/fakeClient.js`). **No live
  WhatsApp account is used in tests.**
- The Baileys adapter (`src/whatsapp/client.js`, `connection.js`, `events.js`)
  is written against the Baileys 7.0.0-rc14 type surface but has **not** been
  exercised against a live WhatsApp account in this phase. Treat live behavior
  (QR pairing, message events, status events, group actions) as *untested until
  a live smoke test is run* on your machine — `docs/LOCAL_SETUP.md` walks
  through it.
