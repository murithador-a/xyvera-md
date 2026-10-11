# Bot branding assets

Drop the bot logo here as **`bot-logo.png`** (any PNG/JPG works — the code
auto-converts it to a WhatsApp profile picture).

- Used automatically as the WhatsApp profile picture on the **first**
  connection (then the flag is remembered; re-apply with `.setbotpp`).
- Served by the `.logo` command.
- Override the path with `BOT_IMAGE_PATH` in `.env`.
