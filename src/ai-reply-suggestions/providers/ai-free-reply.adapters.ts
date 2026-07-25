import { Injectable, Logger } from "@nestjs/common";
import { BrowserChatgptProvider } from "../../ai-free/providers/browser-chatgpt.provider";
import { Llm7FreeProvider } from "../../ai-free/providers/llm7-free.provider";
import { PollinationsFreeProvider } from "../../ai-free/providers/pollinations-free.provider";
import { AiReplyProviderName } from "../entities/whatsapp-ai-settings.entity";
import {
  AiReplyProvider,
  AiReplyProviderRequest,
  AiReplyProviderResult,
} from "./ai-reply-provider";

type FreeInner = {
  generate(request: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    model?: string;
  }): Promise<{ text: string; actualModel: string | null }>;
};

function normalizeModel(model?: string) {
  const value = String(model || "").trim();
  if (!value || value.toLowerCase() === "auto") return undefined;
  return value;
}

async function generateFromFreeProvider(
  inner: FreeInner,
  request: AiReplyProviderRequest,
): Promise<AiReplyProviderResult> {
  const result = await inner.generate({
    messages: [{ role: "user", content: request.prompt }],
    model: normalizeModel(request.model),
  });
  return {
    text: result.text,
    actualModel: result.actualModel,
  };
}

async function generateWithFallback(
  providers: FreeInner[],
  request: AiReplyProviderRequest,
  logger: Logger,
): Promise<AiReplyProviderResult> {
  const errors: string[] = [];
  for (const provider of providers) {
    try {
      return await generateFromFreeProvider(provider, request);
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown provider error";
      logger.warn(`WhatsApp AI free provider failed: ${detail}`);
      errors.push(detail);
    }
  }
  throw new Error(
    errors[0]
      ? `All free AI providers failed: ${errors[0]}`
      : "All free AI providers failed",
  );
}

/** Same free stack as FitCoach /ai-free (LLM7 → Pollinations → Browser). */
@Injectable()
export class AiFreeChainAiReplyProvider implements AiReplyProvider {
  readonly name = "ai-free" as const;
  private readonly logger = new Logger(AiFreeChainAiReplyProvider.name);

  constructor(
    private readonly llm7: Llm7FreeProvider,
    private readonly pollinations: PollinationsFreeProvider,
    private readonly browser: BrowserChatgptProvider,
  ) {}

  generate(request: AiReplyProviderRequest) {
    return generateWithFallback(
      [this.llm7, this.pollinations, this.browser],
      request,
      this.logger,
    );
  }
}

/** Backward-compatible alias for existing whatsapp_ai_settings.provider = dragify-free */
@Injectable()
export class DragifyFreeCompatAiReplyProvider implements AiReplyProvider {
  readonly name = "dragify-free" as const;

  constructor(private readonly chain: AiFreeChainAiReplyProvider) {}

  generate(request: AiReplyProviderRequest) {
    return this.chain.generate(request);
  }
}

@Injectable()
export class Llm7AiReplyProvider implements AiReplyProvider {
  readonly name = "llm7-free" as const;
  constructor(private readonly llm7: Llm7FreeProvider) {}
  generate(request: AiReplyProviderRequest) {
    return generateFromFreeProvider(this.llm7, request);
  }
}

@Injectable()
export class PollinationsAiReplyProvider implements AiReplyProvider {
  readonly name = "pollinations-free" as const;
  constructor(private readonly pollinations: PollinationsFreeProvider) {}
  generate(request: AiReplyProviderRequest) {
    return generateFromFreeProvider(this.pollinations, request);
  }
}

@Injectable()
export class BrowserChatgptAiReplyProvider implements AiReplyProvider {
  readonly name = "browser-chatgpt" as const;
  constructor(private readonly browser: BrowserChatgptProvider) {}
  generate(request: AiReplyProviderRequest) {
    return generateFromFreeProvider(this.browser, request);
  }
}

export const AI_FREE_REPLY_PROVIDER_NAMES = [
  "ai-free",
  "llm7-free",
  "pollinations-free",
  "browser-chatgpt",
  "dragify-free",
] as const satisfies readonly AiReplyProviderName[];
