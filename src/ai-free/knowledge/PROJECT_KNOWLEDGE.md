# So7baFit — FitCoach Project Knowledge

> Edit this file anytime. FitCoach loads it into the system prompt when
> **Project knowledge** is enabled, so the assistant can answer about your app.
>
> This file alone does NOT grant write access to APIs.
> Tool/agent access (create plans, users, etc.) must be added as explicit tools
> with auth + confirmation. See section "Agent tools (future)".

## Product

- **Name:** So7baFit (fitness coaching platform)
- **Stacks:** NestJS backend (`/api/v1`), Next.js frontend, Expo mobile app
- **Roles:** `client`, `coach`, `admin`, `super_admin`
- **Brand:** CSS variables `--color-primary-*`, tenant branding supported

## Monorepo layout

- `backend/` — NestJS API, TypeORM, PostgreSQL, WhatsApp (WPPConnect), AI modules
- `frontend/` — Next.js App Router under `src/app/[locale]/...`
- `mobile/` — Expo React Native app
- Locale routes: `/en/...` and `/ar/...`

## Important frontend routes

- Dashboard: `/[locale]/dashboard`
- WhatsApp CRM: `/[locale]/dashboard/whatsapp`
- FitCoach AI chat: `/[locale]/dashboard/ai-free`
- Chat: `/[locale]/dashboard/chat`
- Workouts / plans: `/[locale]/dashboard/workouts`, `/workouts/plans`
- Nutrition: `/[locale]/dashboard/nutrition`
- Clients/users: `/[locale]/dashboard/users`
- Calculator: `/[locale]/dashboard/calculator`
- Transcript: `/[locale]/dashboard/transcript`
- Billing / money: `/[locale]/dashboard/billing`, `/money`

## Backend API prefix

All REST endpoints are under: `GET/POST/PUT/PATCH/DELETE /api/v1/...`

Auth: Bearer JWT from `localStorage.accessToken` (frontend axios interceptor).

### Core modules & controllers

| Area | Base path | Notes |
|------|-----------|--------|
| Auth | `/auth` | login, users, roles |
| Profile | `/profile` | user profile |
| Plans | `/plans` | workout plans |
| Plan exercises | `/plan-exercises` | exercises inside plans |
| Nutrition | `/nutrition` | meal plans |
| Recipes | `/recipes` | recipe library |
| Chat | `/chat` | in-app messaging |
| WhatsApp | `/whatsapp/...` | accounts, conversations, connect |
| WhatsApp AI | `/whatsapp/.../ai-suggestions` | reply suggestions |
| WhatsApp Demo | `/whatsapp-demo` | isolated demo data |
| FitCoach AI | `/ai-free` | free chat (`/providers`, `/chat`) |
| Forms / intake | `/forms` | client intake |
| Reminders | `/reminders` | reminders |
| Calendar | `/calendar` | calendar events |
| Todos | workspace todos | tasks |
| Billing | `/billing` | subscriptions/invoices |
| Money | `/money` | wallet/finance |
| Stats | `/stats`, `/admin` | dashboards |
| Settings | `/settings` | branding/settings |
| Assets | `/assets` | uploads |
| Notifications | `/notifications` | alerts |
| Feedback | `/feedback` | feedback |
| Transcription | `/transcriptions` | audio → text |
| Weekly reports | `/weekly-reports`, `/coach` | reports |
| Builder | `/builder` | page builder |
| PRs | `/prs` | personal records |
| About user | `/about-user` | client about data |
| Tenant | tenant admin routes | multi-tenant |

## WhatsApp notes

- Real WhatsApp sessions use WPPConnect + Puppeteer/Chrome
- Statuses: `disconnected`, `connecting`, `qr_pending`, `connected`, `error`
- Demo Mode is isolated (`whatsapp_demo_*` tables) and must not mutate real accounts
- Stuck `connecting` can be restarted from the UI (Restart connection)

## FitCoach AI (`/ai-free`)

Providers (free):

1. `llm7-free` (default HTTP)
2. `pollinations-free`
3. `browser-chatgpt` (Puppeteer fallback)

WhatsApp AI suggestions reuse the same free stack via adapters (`ai-free` provider).

## How to teach FitCoach about your project

1. Keep this file updated with:
   - business rules
   - important endpoints (method + path + payload shape)
   - domain vocabulary (package, plan, client, coach…)
   - “do / don’t” policies
2. Enable **Project knowledge** in FitCoach settings
3. Ask questions like: “Where is WhatsApp connect handled?” or “How do meal plans work?”

## Agent tools (future — not enabled by default)

To let the AI *execute* actions (create account, create plan, etc.):

1. Define an allow-list of tools, e.g. `createWorkoutPlan`, `listClients`
2. Each tool wraps an existing Nest service with the same auth/roles as the HTTP API
3. Require confirmation for any write/delete
4. Never give the raw LLM unrestricted HTTP access to production

Until tools are wired, FitCoach can **explain** how to do something using this knowledge file, but it will **not** create data by itself.

## Editing tip

Add a short “Runbook” section below for your team’s common tasks.

### Runbook (customize)

- Create a client: Admin → Users → create with role `client`
- Assign workout: Workouts/Plans → assign to client
- Connect WhatsApp: WhatsApp → Accounts → Connect / Restart connection
- AI reply suggestions: WhatsApp AI settings → enable → provider `ai-free`
