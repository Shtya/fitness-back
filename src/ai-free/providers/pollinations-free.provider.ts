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
export class PollinationsFreeProvider implements AiFreeProvider {
  readonly name = "pollinations-free" as const;
  readonly label = "Pollinations Free";
  readonly description =
    "Anonymous Pollinations text API (short prompts, no API key).";
  private readonly logger = new Logger(PollinationsFreeProvider.name);

  constructor(private readonly config: ConfigService) {}

  async generate(
    request: AiFreeProviderRequest,
  ): Promise<AiFreeProviderResult> {
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n")
      .trim();
    const dialogue = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join("\n");
    const prompt = [system ? `SYSTEM: ${system}` : "", dialogue]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 3500);

    const baseUrl = (
      this.config.get<string>("AI_FREE_POLLINATIONS_BASE_URL") ||
      "https://text.pollinations.ai"
    ).replace(/\/$/, "");
    const timeoutMs = Math.min(
      Math.max(Number(this.config.get("AI_FREE_HTTP_TIMEOUT_MS")) || 90000, 5000),
      180000,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/${encodeURIComponent(prompt)}`, {
        method: "GET",
        headers: { Accept: "text/plain" },
        signal: controller.signal,
      });
      const text = String(await response.text()).trim();
      if (!response.ok) {
        this.logger.warn(
          `Pollinations failed (${response.status}): ${text.slice(0, 200)}`,
        );
        throw new ServiceUnavailableException(
          `Pollinations free provider unavailable (${response.status})`,
        );
      }
      if (!text) {
        throw new BadGatewayException("Pollinations returned an empty response");
      }
      return {
        text,
        provider: this.name,
        actualModel: request.model?.trim() || "pollinations",
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
        throw new ServiceUnavailableException(
          "Pollinations free provider timed out",
        );
      }
      throw new ServiceUnavailableException(
        error instanceof Error
          ? `Pollinations free provider unavailable: ${error.message.slice(0, 180)}`
          : "Pollinations free provider unavailable",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
