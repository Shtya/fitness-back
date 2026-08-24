# Sobha Fit WhatsApp module

Default runtime provider is **Baileys** (WhatsApp Web multi-device). WPPConnect remains an optional fallback, not the production default.

## Runtime requirements

- PostgreSQL. Core schema: `migrations/20260719_add_whatsapp_module.sql`
- Sync watermarks: `migrations/20260817_whatsapp_account_sync_watermarks.sql`
  (`whatsapp_accounts.initial_hydrated_at`, `whatsapp_accounts.last_history_sync_at`)
- A 32-byte Base64 key in `WHATSAPP_SESSION_ENCRYPTION_KEY`
- Baileys session files under `WHATSAPP_BAILEYS_DIR` (or `tokens/baileys`)
- Do **not** run the WhatsApp process on Vercel serverless (needs a persistent VPS/PM2 process)

New schema changes should go through SQL migrations. `WhatsAppSchemaService` only applies a small `IF NOT EXISTS` safety net for already-deployed databases.

## Sync model

```
Initial Load (Postgres) → Cached UI → Background hydrate → Incremental reconnect → Realtime socket
```

- First paint comes from Postgres. The workspace must not wait for a full provider dump.
- Open-chat `POST .../sync/latest` is skipped when the conversation already has local Postgres rows (`local_replica`), or when it is empty but already hydrated (`hydrated_empty` via `lastProviderSyncAt` on the inbox DTO). Pass `?force=1` only for an explicit repair action.
- Automatic retry, socket reconnect, search, and clone-voice prefetch must never send `force=1`.
- Empty-thread recovery is at most one non-forced retry; after that wait for live socket / history_sync.
- Soft catch-up uses provider `after: newestLocalProviderId` instead of re-pulling a full latest page every open.
- Frontend mirrors this with `whatsapp-message-sync.js` (`shouldProviderBackfill` / `shouldSkipOpenChatNetwork`) — short chats are not treated as incomplete merely because they have fewer than 100 messages.
- `syncFullHistory` is **off** unless `WHATSAPP_SYNC_FULL_HISTORY=1|true|yes`.
- After `initialHydratedAt` is set, reconnect/restart runs an incremental inbox pass, not another full bootstrap.
- History chunks are persisted in bulk and debounced into a single inbox reconcile.
- Live inbound messages use a separate persist queue so they are not blocked by history dumps.

## API and realtime

HTTP endpoints are under `/api/v1/whatsapp`. The Socket.IO namespace is `/whatsapp`. Clients must explicitly watch an account or conversation; each watch request is authorized against the account ACL and assignment policy.

Baileys supplies QR/pairing, recent chat history, groups, media metadata, and status. Full archive history is opt-in. Incoming media stays metadata-only until the download endpoint is requested.

Provider tokens/sessions are encrypted with AES-256-GCM in `whatsapp_provider_sessions`.
