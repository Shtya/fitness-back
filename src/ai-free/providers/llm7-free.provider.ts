import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AiFreeProvider,
  AiFreeProviderRequest,
  AiFreeProviderResult,
} from "./ai-free-provider";

@Injectable()
export class Llm7FreeProvider implements AiFreeProvider {
  readonly name = "llm7-free" as const;
  readonly label = "LLM7 Free";
  readonly description =
    "Free OpenAI-compatible API (no paid key required for open models).";
  private readonly logger = new Logger(Llm7FreeProvider.name);

  constructor(private readonly config: ConfigService) {}

  async generate(
    request: AiFreeProviderRequest,
  ): Promise<AiFreeProviderResult> {
    const baseUrl = (
      this.config.get<string>("AI_FREE_LLM7_BASE_URL") ||
      "https://api.llm7.io/v1"
    ).replace(/\/$/, "");
    const model =
      request.model?.trim() ||
      this.config.get<string>("AI_FREE_LLM7_MODEL") ||
      "gpt-oss:20b";
    const apiKey =
      this.config.get<string>("AI_FREE_LLM7_API_KEY") || "unused";
    const timeoutMs = Math.min(
      Math.max(
        Number(request.httpTimeoutMs) ||
          Number(this.config.get("AI_FREE_HTTP_TIMEOUT_MS")) ||
          90000,
        5000,
      ),
      180000,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: request.messages,
          max_tokens: Math.min(
            Math.max(
              Number(request.maxTokens) ||
                Number(this.config.get("AI_FREE_MAX_TOKENS")) ||
                1024,
              64,
            ),
            8192,
          ),
          temperature: 0.2,
        }),
        signal: controller.signal,
      });

      const raw = await response.text();
      if (!response.ok) {
        this.logger.warn(`LLM7 failed (${response.status}): ${raw.slice(0, 200)}`);
        throw new ServiceUnavailableException(
          `LLM7 free provider unavailable (${response.status})`,
        );
      }

      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new BadGatewayException("LLM7 returned invalid JSON");
      }

      const message = parsed?.choices?.[0]?.message;
      const text = String(
        message?.content ||
          message?.reasoning ||
          message?.reasoning_content ||
          "",
      ).trim();
      if (!text) {
        throw new BadGatewayException("LLM7 returned an empty response");
      }

      return {
        text,
        provider: this.name,
        actualModel: parsed?.model ? String(parsed.model) : model,
      };
    } catch (error) {
      if (
        error instanceof ServiceUnavailableException ||
        error instanceof BadGatewayException
      ) {
        throw error;
      }
      const name = error instanceof Error ? error.name : "";
      if (name === "AbortError") {
        throw new ServiceUnavailableException("LLM7 free provider timed out");
      }
      throw new ServiceUnavailableException(
        error instanceof Error
          ? `LLM7 free provider unavailable: ${error.message.slice(0, 180)}`
          : "LLM7 free provider unavailable",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
