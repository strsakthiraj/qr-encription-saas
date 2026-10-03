# QRDrop: QR-based secure file sharing

Sender signs in, uploads a file, and shows a QR code. The receiver scans it and streams or downloads the file in the browser, with no account needed. Files live in a **private Telegram channel**; the browser never sees the bot token, file IDs, or Telegram URLs.

```
Browser (React) ──JWT──▶ upload / create-token  ─▶ Supabase Edge Functions ─▶ Telegram Bot API (private channel)
Receiver (scan) ──token─▶ resolve ─▶ signed 10-min stream URL ─▶ stream (proxies bytes, supports Range)
                                  └─ Postgres (RLS): files, share_tokens (SHA-256 hashes only)
```

## Setup
1. **Telegram:** create a bot with @BotFather. Create a **private channel**, add the bot as admin (post messages). Get the channel ID (forward a channel post to @RawDataBot; it looks like `-100…`).
2. **Supabase:** create a project, then:
   ```bash
   npm i -g supabase && supabase login
   supabase link --project-ref YOUR_REF
   supabase db push                      # applies supabase/migrations/0001_init.sql
   supabase secrets set APP_URL=https://your-app.example.com \
     TELEGRAM_BOT_TOKEN=... TELEGRAM_CHANNEL_ID=-100... STREAM_SIGNING_SECRET=$(openssl rand -hex 32)
   supabase functions deploy upload create-token resolve stream
   ```
   `resolve` and `stream` are public (`supabase/config.toml`); the other two require a user JWT.
3. **Frontend:** `cp .env.example .env`, fill only the two `VITE_*` values, then `npm install && npm run dev`.
   For local dev set `APP_URL=http://localhost:5173` in the function secrets (CORS + QR links).
4. Deploy `dist/` (`npm run build`) to any static host with an SPA fallback to `index.html` so `/r/:token` works.

## Security model
- Raw tokens are 256-bit random values, shown once in the QR; the database stores only SHA-256 hashes.
- `consume_token` validates expiry, revocation, and view limit and increments views in one atomic statement. It is callable by `service_role` only.
- Scans exchange the token for an HMAC-signed stream URL valid for 10 minutes; the token itself is not reused for media requests.
- Failures return one generic error, so tokens cannot be probed for state.
- RLS: owners can only read/delete their own files and read/revoke their own tokens. Inserts happen server-side only.
- Service role key, bot token, and signing secret exist only as Edge Function secrets.
- Only safe media types render inline; everything else is forced to download, with `nosniff` and `CSP: sandbox`.
- CORS is locked to `APP_URL`; the receiver page sets `no-referrer`.

## Known limits (next steps)
- Telegram's cloud Bot API caps downloads at 20 MB. Run a [local Bot API server](https://github.com/tdlib/telegram-bot-api) to go up to 2 GB, then raise `MAX` in `upload`.
- No per-IP rate limiting on `resolve`; add one (Supabase/Cloudflare WAF) before going public. Tokens are unguessable, but throttling limits abuse.
- No UI yet for revoking tokens (the RLS policy is in place), tests, or Telegram webhook upload-by-chat.
- Streaming through Edge Functions has per-invocation time limits, so very large videos may stall.
