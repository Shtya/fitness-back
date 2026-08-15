# AI Content Automation Studio

Single-page control center at `/dashboard/ai-content-studio`.

## Architecture

- **Frontend:** `frontend/src/app/[locale]/dashboard/ai-content-studio`
- **Backend module:** `backend/src/ai-content-studio` (NestJS + TypeORM + `@nestjs/schedule`)
- **Provider adapter pattern:** `AIProvider` with `generateText` / `generateImage` / `validateKey` / `getModels`
- **Secrets:** AES-GCM encrypted in `ai_content_studio_secrets` (never localStorage / NEXT_PUBLIC)
- **Non-sensitive UI config:** `localStorage` key `automationStudio:v2`
- **Scheduler:** Nest cron every minute → timezone-aware due check (`Africa/Cairo` default 21:00)

## Providers

**Default stack (Gemini):**
- Topic / daily trend: `gemini-2.5-flash`
- Content (Coachiano posts): `gemini-2.5-pro`
- Image: `gemini-3-pro-image` (Nano Banana Pro)

On first open, `GEMINI_API_KEY` / `GOOGLE_AI_API_KEY` from `.env` is copied into the user's studio secrets so the UI is ready.

**Optional keyed providers:** Groq · Cloudflare Workers AI · Hugging Face · OpenAI-compatible · ComfyUI · Custom HTTP

## Env (see `.env.example`)

Put the Gemini key in `.env` (or paste it once in the Studio UI). Optional extra env fallbacks:

- `GEMINI_API_KEY` / `GOOGLE_AI_API_KEY`
- `GROQ_API_KEY`
- `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`
- `HUGGINGFACE_API_KEY` / `HF_TOKEN`
- `COMFYUI_URL`
- `FACEBOOK_PAGE_ID` + `FACEBOOK_ACCESS_TOKEN`
- `INSTAGRAM_BUSINESS_ACCOUNT_ID` + `INSTAGRAM_ACCESS_TOKEN`
- `AI_CONTENT_STUDIO_PUBLIC_BASE_URL` (required for Instagram publish)
- `AI_CONTENT_STUDIO_ENCRYPTION_KEY` (optional 32-byte base64)

## Quick start

1. Start backend + frontend as usual.
2. Open `/en/dashboard/ai-content-studio` (or `/ar/...`).
3. Save provider API keys via **Replace → Save** (server-side).
4. **Test Module** per step, then **Run Now**.
5. Review preview → **Publish Facebook / Instagram** (or enable Auto Publish).
