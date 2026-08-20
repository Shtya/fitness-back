# AI Module

Independent, multi-provider AI layer. Features must never read API keys, Gemini URLs, or prices.

```js
ai.generateText({ prompt, model?, user, feature? })
ai.generateImage({ prompt, model?, user, feature? })
```

If `model` is omitted, the default model from AI Settings is used.

## Add a provider later

1. Implement `AiProvider` in `providers/`.
2. Register the class in `ai.module.ts` (`AI_PROVIDERS_TOKEN` factory).
3. Add models from **Settings → AI Module → Model Registry** (no feature code changes).

## Settings

Admin page: `/dashboard/settings` → AI Module.

Keys are AES-256-GCM encrypted. The frontend only ever receives `last4`.
