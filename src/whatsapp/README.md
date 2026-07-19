# Sobha Fit WhatsApp module

## Runtime requirements

- PostgreSQL migration: `migrations/20260719_add_whatsapp_module.sql`
- A 32-byte Base64 key in `WHATSAPP_SESSION_ENCRYPTION_KEY`
- `@wppconnect-team/wppconnect@2.2.3` and `qrcode@1.5.4`
- Chrome/Chromium available to Puppeteer (`CHROME_EXECUTABLE_PATH` is optional)

Install the provider packages after the npm registry certificate is trusted:

```bash
npm install @wppconnect-team/wppconnect@2.2.3 qrcode@1.5.4
```

Provider tokens are encrypted with AES-256-GCM and stored in
`whatsapp_provider_sessions`; they are loaded through WPPConnect's custom token
store during application bootstrap. Incoming media is metadata-only until the
download endpoint is requested.

## API and realtime

HTTP endpoints are under `/api/v1/whatsapp`. The Socket.IO namespace is
`/whatsapp`. Clients must explicitly watch an account or conversation; each
watch request is authorized against the account ACL and assignment policy.

WPPConnect currently supplies QR, chat history, groups, participants, media and
status capabilities. The provider contract is intentionally capability-based so
a Meta Cloud adapter can use webhooks/history-sync without pretending arbitrary
history retrieval exists.
