# Meta WhatsApp Cloud API (Lead Scout)

Official Graph API integration — separate from the WPPConnect `/dashboard/whatsapp` module.

## Capabilities (Meta Cloud API)

| Feature | Status |
|---------|--------|
| Text / templates | Working |
| Image / voice / document send | Working (upload → Graph media → send) |
| Inbound webhook + delivery/read status | Working |
| Media preview in chat | Working (auth media proxy) |
| Search / unread filter / mark read | Working |
| Sync from system DB for a phone | Working |
| Import WhatsApp history before webhook | **Not possible** with Cloud API (UI explains this) |
| Stories / Status | **Not supported** — not shown in UI |
| Emoji picker / fake chrome | Removed |

## Setup

1. Apply migration: `backend/migrations/20260730_add_meta_whatsapp.sql`
2. Optional env:
   - `META_WHATSAPP_ENCRYPTION_KEY` (32-byte base64) — otherwise JWT-derived key
   - `META_GRAPH_API_VERSION` (default `v21.0`)
   - `META_WHATSAPP_PUBLIC_API_URL` — public API origin used to show the copyable webhook URL
3. Open `/dashboard/meta-whatsapp` → gear / Meta config
4. Fill: Permanent Access Token, Phone Number ID, WABA ID, Verify Token (Generate + Copy), App Secret
5. Copy **Webhook callback URL** + **Verify Token** into Meta Developer → WhatsApp → Configuration
6. Subscribe to `messages` → **Verify connection** → **Enable integration**

## Lead Scout

- Header link opens Meta WhatsApp
- Lead document → Open Meta chat
- Selection bar → Meta template (bulk approved templates only)

## Policy

- Free-form text only inside the 24h customer care window
- Outside the window / cold outreach → Meta-approved templates only
- Bulk sends use rate limiting, retries, and activity logs
