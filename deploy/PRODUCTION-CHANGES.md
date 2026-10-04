# Production changes — WhatsApp audit 2026-09-27

Server-side steps that code cannot apply. Nothing here has been run on production.
Run them in order during a quiet window. Each step has a check and a rollback.

## 1. Environment (`/root/backend/.env`)

```bash
cp /root/backend/.env /root/backend/.env.bak.$(date +%F)
cat >> /root/backend/.env <<'EOF'
DATABASE_SYNCHRONIZE=false
LOG_LEVEL=log
EOF
```

- `DATABASE_SYNCHRONIZE=false` is already the code default; this makes it explicit.
- `LOG_LEVEL=log` hides per-event `debug` traces (presence ≈ 35% of current log lines).
- `WHATSAPP_SESSIONS_ENABLED` / `BACKGROUND_JOBS_ENABLED` default to `true`; do **not** set them to `false` here.

Apply: `pm2 restart backend --update-env` · Check: `pm2 logs backend --lines 50` shows `Server is running`.
Rollback: restore the `.bak` file and restart.

## 2. DB migration (indexes)

File: `backend/migrations/20260928_whatsapp_p1_indexes.sql` (adds `idx_whatsapp_conversations_contact_id`, drops duplicate `idx_whatsapp_message_reactions_message_id`).

```bash
psql "$DATABASE_URL" -f migrations/20260928_whatsapp_p1_indexes.sql   # no -1 / --single-transaction (CONCURRENTLY)
```

Check:

```sql
SELECT indexname FROM pg_indexes
 WHERE tablename IN ('whatsapp_conversations', 'whatsapp_message_reactions');
```

Rollback: statements at the bottom of the migration file.

## 3. PM2 log rotation (SR3)

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
```

Check: `pm2 conf pm2-logrotate`, then `ls -lh /root/.pm2/logs` next day.
Rollback: `pm2 uninstall pm2-logrotate`.

## 4. nginx (SR2)

Back up first:

```bash
cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak.$(date +%F)
cp /etc/nginx/sites-enabled/<api-site> /root/<api-site>.bak.$(date +%F)
```

`http { }` in `nginx.conf` — uncomment/replace the gzip block:

```nginx
gzip on;
gzip_proxied any;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_vary on;
gzip_types application/json application/javascript text/css text/plain text/xml application/xml image/svg+xml;
```

`server { }` for `api.so7bafit.com`:

```nginx
# nginx >= 1.25.1:
listen 443 ssl;
http2 on;
# older nginx (check `nginx -v`): listen 443 ssl http2;
```

Inside the existing `location /socket` block (Socket.IO path `/socket.io/`):

```nginx
proxy_read_timeout 75s;   # > Socket.IO pingInterval (25s) + pingTimeout (20s)
proxy_send_timeout 75s;
```

Apply: `nginx -t && systemctl reload nginx`.
Check: `curl -sI --http2 https://api.so7bafit.com/api/v1 | head -1` → `HTTP/2`;
`curl -s -H 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}\n' <json endpoint>` smaller than without the header.
Rollback: restore both `.bak` files, `nginx -t && systemctl reload nginx`.

## 5. Redis region (I1 / SR5) — owner decision

Redis is in us-east-1 while the server is in France and the DB in Frankfurt (~100 ms per round-trip).
Code now needs 1–2 round-trips per presence read instead of ~200, but the region still adds latency to every
Redis call. Options: Redis in eu-central-1, or local Redis bound to `127.0.0.1` with `maxmemory 256mb`.
Presence/lock keys are short-lived; losing them on switch is acceptable.
Rollback: restore the old `REDIS_*` values and restart.

## 6. DB migration (P2 index)

File: `backend/migrations/20260928_whatsapp_p2_indexes.sql` (adds expression index
`idx_whatsapp_contacts_account_phone_digits` used by LID↔PN / phone lookups).

```bash
psql "$DATABASE_URL" -f migrations/20260928_whatsapp_p2_indexes.sql   # no -1 (CONCURRENTLY)
```

Check: `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_whatsapp_contacts_account_phone_digits';`
Rollback: `DROP INDEX CONCURRENTLY IF EXISTS idx_whatsapp_contacts_account_phone_digits;`

## 7. DB pool / Supavisor mode (P2)

Session mode (`:5432`) holds one upstream slot per client connection, so the code caps the pool at 8.
Transaction mode (`:6543`) is safe for this backend (no named prepared statements, advisory locks, LISTEN or
session `SET`) and allows a pool of up to 20.

```bash
cp /root/backend/.env /root/backend/.env.bak.$(date +%F)
# edit: DATABASE_PORT=6543  DATABASE_POOL_SIZE=12  (optional: DATABASE_POOLER_MODE=transaction)
pm2 restart backend --update-env
```

Check: `pm2 logs backend --lines 50` shows `Server is running`; inbox and message send work.
Rollback: restore the `.bak` file (`DATABASE_PORT=5432`) and restart.

## 8. Local development isolation (S6)

The local `.env` must not point at the production DB/Redis. Until a separate dev DB exists, run locally with:

```env
WHATSAPP_SESSIONS_ENABLED=false
BACKGROUND_JOBS_ENABLED=false
DATABASE_SYNCHRONIZE=false
```

Recommended: a Supabase branch or local Postgres for dev, and a separate Redis DB/instance.

## 9. Secrets (P0 owner actions)

- Rotate the Supabase DB password (it exists in git history) and update `.env` on server + local.
- Revoke/regenerate the GitHub deploy key. The next `git pull` removes the tracked `/root/backend/deploy-key`;
  copy it elsewhere first if any SSH config references it.

## 10. CORS allowlist (P4)

HTTP and every Socket.IO gateway now allow only `CORS_ORIGIN`, falling back to `FRONTEND_URL` (comma-separated).
Production already has `FRONTEND_URL=http://localhost:3000,http://127.0.0.1:3000,https://so7bafit.com,https://www.so7bafit.com`
(checked read-only on 2026-09-28), so no env change is needed for the live dashboard.

- To allow another browser origin (preview deploy, admin subdomain), set `CORS_ORIGIN` to the full list, then restart.
- Requests without an `Origin` header (mobile app, server-to-server, webhooks) are not affected.
- Public `/uploads/*` assets still send `Access-Control-Allow-Origin: *`.

Check after deploy:

```bash
curl -s -o /dev/null -D - -X OPTIONS -H 'Origin: https://so7bafit.com' -H 'Access-Control-Request-Method: GET' https://api.so7bafit.com/api/v1/whatsapp/unread | grep -i access-control-allow-origin
curl -s -o /dev/null -D - -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: GET' https://api.so7bafit.com/api/v1/whatsapp/unread | grep -i access-control-allow-origin || echo "blocked (expected)"
```

Rollback: `CORS_ORIGIN=*` (takes precedence over `FRONTEND_URL`) reflects any origin again (the old behavior). Avoid this unless urgent.

## 11. nginx forwarding headers + HSTS (S5 / SR10)

The app now trusts `X-Forwarded-*` from loopback only (`trust proxy = loopback`) and rate-limits
`/auth/login|forgot-password|reset-password` per IP + email. Today only `location /` forwards the client IP;
`/api/v1/`, `/socket` and `/uploads` do not, so every request looks like `127.0.0.1` and HSTS is never sent.

Add inside **each** of `location /api/v1/`, `location /socket`, `location /uploads` (site file for `api.so7bafit.com`):

```nginx
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

In the `server { }` block (start HSTS small; browsers keep it until `max-age` expires):

```nginx
server_tokens off;
proxy_hide_header X-Powered-By;
add_header Strict-Transport-Security "max-age=86400" always;   # raise to 15552000 after a week without issues
```

Apply: `nginx -t && systemctl reload nginx`.
Check: `curl -sI https://api.so7bafit.com/api/v1 | grep -Ei 'strict-transport|x-powered-by|server:'` → HSTS present, no `X-Powered-By`, no nginx version.
Rollback: restore the `.bak` site file from §4, `nginx -t && systemctl reload nginx`.

## 12. Node LTS + PM2 memory guard (I4 / I5 / SR4 / SR6)

Checked read-only 2026-09-28: backend runs on Node **21.7.3** (odd release, EOL) with no `max_memory_restart`.

```bash
nvm install 22 && nvm use 22            # or the distro/NodeSource package if nvm is not used
cd /root/backend && npm ci && npm run build   # native deps (bcrypt) must be rebuilt for Node 22
pm2 delete backend
pm2 start dist/src/main.js --name backend --cwd /root/backend --max-memory-restart 1G --time
pm2 save
```

Check: `pm2 describe backend | grep -Ei 'node.js version|max memory'`, then inbox + send + media download.
Rollback: `nvm use 21`, `npm ci && npm run build`, start the same `pm2 start` command without the flag.
Note: a memory restart drops sockets for a few seconds; clients reconnect and resync (P3 delta sync).

## 13. Media outside the git tree (I6 / SR8)

Checked 2026-09-28: `/root/backend/uploads` is 9.3 GB inside the repo, 307 user files are tracked in git
(chat voice notes, form uploads, `storage/meta-whatsapp-media`), and new media shows as untracked files.
`.gitignore` now ignores `/uploads/` and `/storage/` for new files. Tracked files must **not** be removed with
`git rm --cached` before the move below — the next `git pull` on the server would delete them from disk.

Order (quiet window):

```bash
pm2 stop backend
mkdir -p /var/lib/so7bafit
rsync -a /root/backend/uploads/ /var/lib/so7bafit/uploads/
rsync -a /root/backend/storage/ /var/lib/so7bafit/storage/
mv /root/backend/uploads /root/backend/uploads.old && mv /root/backend/storage /root/backend/storage.old
ln -s /var/lib/so7bafit/uploads /root/backend/uploads
ln -s /var/lib/so7bafit/storage /root/backend/storage
pm2 start backend
```

Then, in the repo (dev machine): `git rm -r --cached uploads storage`, commit, push; on the server `git pull`
(the symlinks are untracked and ignored, so pull no longer touches media). Remove `*.old` after a week.
`WHATSAPP_MEDIA_ROOT` is already set in the server `.env`; if it points inside `/root/backend`, it keeps working
through the symlink — optionally repoint it to `/var/lib/so7bafit/...` directly.
Also restore the server `package-lock.json` drift: `git diff package-lock.json` → keep the repo version.
Check: open old and new chat media, recipes images, form uploads. Rollback: remove symlinks, `mv *.old` back.

## 14. Unused services (I7 / I8 / SR9) — owner decision

- PM2 `frontend` (`/root/frontend`, old build, online 6 days) listens on `*:3000`. ufw blocks 3000 from the
  internet (checked), and nginx has no route to it. After confirming nothing uses it: `pm2 delete frontend && pm2 save`.
  Rollback: `cd /root/frontend && pm2 start bash --name frontend -- -c "npm run start"` (the current start command).
- Local PostgreSQL is active on `127.0.0.1:5432` but the app uses Supabase. After confirming no other service
  uses it: `systemctl disable --now postgresql`. Rollback: `systemctl enable --now postgresql`.

## 15. Socket.IO horizontal scale (I4) — owner decision

Scoped events now go through Socket.IO rooms (`whatsapp:account:<id>`, `:all`, `:assigned:<userId>`), so a
Redis adapter can fan them out across processes without code changes to the emit paths. This needs a new
dependency (`@socket.io/redis-adapter`) and a dedicated Redis connection pair; do it only before running
more than one backend process (PM2 cluster / second server). Single-process production does not need it.

## 16. Query visibility (SR7)

Enable `pg_stat_statements` from the Supabase dashboard (Database → Extensions). Rollback: disable it there.

## 17. AI key exposure (settings) — owner decision

`GET /settings` no longer returns another organisation's settings (403) and never returns `aiSecretKey` to
clients; admins, their coaches (exercise AI helper) and super admins still receive it. Remaining risk: the
exercise AI helper calls OpenRouter from the coach's browser, and `getOrCreate` copies the platform
`aiSecretKey` env value into each new settings row. Full fix = a server-side AI endpoint (like
`nutrition.service`) and stop seeding the env key; then rotate the OpenRouter key.

## 18. Instagram video download needs a session

Checked 2026-09-28: production yt-dlp (2026.08.19, and the 2026.09.27 nightly) gets
"Instagram sent an empty media response" for public reels. Instagram no longer serves media to
anonymous requests; TikTok and Facebook still do. The code now uses a cookies file when configured.

1. Log in to Instagram in a browser with a **dedicated** account (not a personal or business one —
   automated downloads can get an account challenged).
2. Export cookies for `instagram.com` in Netscape format (e.g. the "Get cookies.txt LOCALLY" extension).
3. Upload and lock it down:

```bash
mkdir -p /root/secure && chmod 700 /root/secure
# scp instagram-cookies.txt root@<server>:/root/secure/
chmod 600 /root/secure/instagram-cookies.txt
echo 'YTDLP_INSTAGRAM_COOKIES=/root/secure/instagram-cookies.txt' >> /root/backend/.env
pm2 restart backend --update-env
```

Check (no file written): `cd /root/backend && tools/yt-dlp --cookies /tmp/ig-check.txt --simulate --print id -- <reel url>`
after `cp /root/secure/instagram-cookies.txt /tmp/ig-check.txt` (yt-dlp rewrites the jar it is given), then `rm /tmp/ig-check.txt`.
When downloads start failing with "saved login session has expired", export fresh cookies and replace the file (no restart needed).
Rollback: remove the env line and restart.

## 19. Facebook Engagement Manager (2026-09-30)

New module `backend/src/facebook-engagement` + dashboard `/dashboard/facebook-engagement`. It publishes comments
only as Pages the user manages, on those Pages' own posts, through the official Graph API. Nothing below has
been applied. Run 19.1 before (or right after) deploying the code: until then the module's endpoints fail
(tables missing) and the worker logs one `Publishing tick failed` warning. The sidebar item is hidden by default
(`defaultVisible: false`).

### 19.1 DB migration (additive, re-runnable)

File: `backend/migrations/20260929_facebook_engagement.sql` — 7 new `fb_engagement_*` tables, no changes to
existing tables. The runner sends the file as one multi-statement query, so it applies atomically.

```bash
cd /root/backend && node scripts/run-sql-migration.mjs migrations/20260929_facebook_engagement.sql
```

Check:

```sql
SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'fb_engagement_%' ORDER BY 1;  -- 7 rows
```

Rollback (drops only this module's data):

```sql
DROP TABLE IF EXISTS fb_engagement_activity_logs, fb_engagement_jobs, fb_engagement_comments,
  fb_engagement_campaigns, fb_engagement_posts, fb_engagement_accounts, fb_engagement_connections;
```

### 19.2 Environment (`/root/backend/.env`)

```bash
cp /root/backend/.env /root/backend/.env.bak.$(date +%F)
cat >> /root/backend/.env <<EOF
FB_ENGAGEMENT_ENCRYPTION_KEY=$(openssl rand -base64 32)
EOF
# After step 19.3 (Meta app), add:
# FACEBOOK_APP_ID=<app id>
# FACEBOOK_APP_SECRET=<app secret>
pm2 restart backend --update-env
```

| Key | Required | Notes |
| --- | --- | --- |
| `FB_ENGAGEMENT_ENCRYPTION_KEY` | Strongly recommended | base64 of 32 bytes; encrypts stored Facebook tokens (AES-256-GCM). If unset, a key is derived from `JWT_SECRET` — rotating `JWT_SECRET` would then make stored tokens unreadable (users must reconnect). Set it **before** the first connection and never change it afterwards. |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | For "Continue with Facebook" | Without them, OAuth is disabled and users can still connect with a Page/User access token. |
| `FACEBOOK_OAUTH_REDIRECT_URI` | Optional | Default `${META_WHATSAPP_PUBLIC_API_URL origin}/api/v1/facebook-engagement/oauth/callback`. Must match the Meta app exactly. |
| `FB_ENGAGEMENT_MIN_INTERVAL_SECONDS` | Optional | Minimum gap between two comments from the same Page across all campaigns (default `10`). |
| `FB_ENGAGEMENT_GRAPH_VERSION` | Optional | Falls back to `META_GRAPH_API_VERSION`, then `v21.0`. |

The OAuth callback redirects to the frontend origin from the existing `FRONTEND_URL` allowlist.
The publishing worker runs every 5 s only when `BACKGROUND_JOBS_ENABLED` is not `false` (production default).
Jobs are claimed with `FOR UPDATE SKIP LOCKED`, so more than one backend process is safe.

Check: `curl -s -H "Authorization: Bearer <token>" https://<api>/api/v1/facebook-engagement/config` →
`oauthConfigured: true` once the app keys are set.
Rollback: restore the `.bak` file and restart (stored tokens become unreadable if the key is removed).

### 19.3 Meta app (owner action)

1. developers.facebook.com → the app → add **Facebook Login for Business** (or Facebook Login).
2. Valid OAuth Redirect URIs: the `redirectUri` shown on the dashboard Accounts page (= 19.2 default).
3. Permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_engagement`.
   In Development mode they work only for app roles (admins/developers/testers); for other users they need
   **App Review** + Business Verification. Do not request more permissions than these three.
4. Page roles: the connecting user needs a Page task that includes `MODERATE` (Page admin/moderator).

Limits kept by design: no personal profiles, no other people's Pages/posts, no groups, one comment per unique
message per post, paced per Page; Facebook policy/rate-limit errors pause or cancel the queue instead of retrying.

## 20. Sidebar page access per role / per user (2026-09-30)

New module `backend/src/page-access` + dashboard `/dashboard/super-admin/page-access` (super admin only).
Each page per role is `default` (shown), `optional` (Marketplace) or `locked` (hidden + blocked by the Next.js
middleware); the super admin can also pin or lock pages per user from the Users page. Nothing below has been
applied. Deploy order does not matter: until 20.1 runs, `/auth/me` and login return no restrictions (one
`Page access tables are missing` warning) and only the new save endpoints fail.

### 20.1 DB migration (additive, re-runnable)

File: `backend/migrations/20260930_page_access.sql` — 2 new tables (`role_page_settings`,
`user_page_overrides`), no changes to existing tables. Applied atomically by the runner.

```bash
cd /root/backend && node scripts/run-sql-migration.mjs migrations/20260930_page_access.sql
```

Check:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('role_page_settings', 'user_page_overrides') ORDER BY 1;  -- 2 rows
```

Rollback (drops only page-access settings; users fall back to the code defaults):

```sql
DROP TABLE IF EXISTS user_page_overrides, role_page_settings;
```

### 20.2 Behaviour notes

- Signed-in users pick up changes within about a minute (on tab focus); the middleware cookie is refreshed then.
- Locks are UI/navigation enforcement (the `user` cookie is not signed). API authorization stays role-based.
- Saving a user's overrides clears the old `users.allowedPages` allowlist for that user. Users with an old list
  keep it (now also enforced by the middleware) until the super admin saves the new editor.
- No env changes and no restart beyond the normal code deploy.
