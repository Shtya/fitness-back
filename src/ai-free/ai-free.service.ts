import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { User } from "../../entities/global.entity";
import { AiFreeKnowledgeService } from "./ai-free-knowledge.service";
import { AiFreeChatDto, AiFreeTitleDto } from "./dto/ai-free.dto";
import {
  AI_FREE_PROVIDER_LIST,
  AiFreeProvider,
  AiFreeProviderName,
} from "./providers/ai-free-provider";

@Injectable()
export class AiFreeService {
  private readonly logger = new Logger(AiFreeService.name);
  private readonly rateBuckets = new Map<string, number[]>();
  private readonly providers: Map<string, AiFreeProvider>;

  constructor(
    @Inject(AI_FREE_PROVIDER_LIST) providers: AiFreeProvider[],
    private readonly config: ConfigService,
    private readonly knowledge: AiFreeKnowledgeService,
  ) {
    this.providers = new Map(
      providers.map((provider) => [provider.name, provider]),
    );
  }

  listProviders() {
    return {
      defaultProvider: this.defaultProviderName(),
      providers: [...this.providers.values()].map((provider) => ({
        name: provider.name,
        label: provider.label,
        description: provider.description,
      })),
      knowledge: this.knowledge.getStatus(),
    };
  }

  knowledgeStatus() {
    return this.knowledge.getStatus();
  }

  async generateTitle(user: User, dto: AiFreeTitleDto) {
    if (!user?.id) {
      throw new BadRequestException("Authentication required");
    }
    this.assertRateLimit(`${user.id}:title`);
    const message = String(dto.message || "").trim();
    if (!message) {
      throw new BadRequestException("Message is required");
    }
    const locale = String(dto.locale || "en").toLowerCase().startsWith("ar")
      ? "ar"
      : "en";
    const system =
      locale === "ar"
        ? 'اكتب عنواناً قصيراً ومعبّراً للمحادثة (3 إلى 6 كلمات) بناءً على أول رسالة من المستخدم فقط. أعد العنوان فقط بدون علامات اقتباس أو شرح.'
        : 'Write a short expressive chat title (3 to 6 words) based only on the user\'s first message. Return the title only, with no quotes or explanation.';

    const preferred = dto.provider || this.defaultProviderName();
    const order = this.buildProviderOrder(preferred, true);
    let lastError: unknown;
    for (const name of order) {
      const provider = this.providers.get(name);
      if (!provider) continue;
      try {
        const result = await provider.generate({
          messages: [
            { role: "system", content: system },
            { role: "user", content: message.slice(0, 800) },
          ],
          model: undefined,
        });
        const title = String(result.text || "")
          .replace(/^["'«»]+|["'«»]+$/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60);
        if (!title) continue;
        return {
          ok: true,
          title,
          provider: result.provider,
          actualModel: result.actualModel,
        };
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `AI Free title provider ${name} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    throw new HttpException(
      {
        statusCode: HttpStatus.BAD_GATEWAY,
        message:
          lastError instanceof Error
            ? lastError.message
            : "Could not generate chat title",
      },
      HttpStatus.BAD_GATEWAY,
    );
  }

  async chat(user: User, dto: AiFreeChatDto) {
    if (!user?.id) {
      throw new BadRequestException("Authentication required");
    }
    this.assertRateLimit(String(user.id));

    const messages = dto.messages.map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));
    if (!messages.some((message) => message.role === "user")) {
      throw new BadRequestException("At least one user message is required");
    }

    const knowledgeDefault =
      String(this.config.get("AI_FREE_PROJECT_KNOWLEDGE") ?? "true") !== "false";
    const useProjectKnowledge =
      dto.useProjectKnowledge === undefined
        ? knowledgeDefault
        : Boolean(dto.useProjectKnowledge);

    let usedKnowledge = false;
    if (useProjectKnowledge) {
      const context = this.knowledge.buildSystemContext();
      if (context) {
        usedKnowledge = true;
        const existingSystem = messages
          .filter((message) => message.role === "system")
          .map((message) => message.content)
          .join("\n\n")
          .trim();
        const withoutSystem = messages.filter(
          (message) => message.role !== "system",
        );
        messages.splice(0, messages.length, {
          role: "system",
          content: existingSystem
            ? `${context}\n\nAdditional instructions:\n${existingSystem}`
            : context,
        }, ...withoutSystem);
      }
    }

    const preferred = dto.provider || this.defaultProviderName();
    const allowFallback = dto.allowFallback !== false;
    const order = this.buildProviderOrder(preferred, allowFallback);
    const errors: string[] = [];
    const startedAt = Date.now();

    for (const name of order) {
      const provider = this.providers.get(name);
      if (!provider) continue;
      try {
        const result = await provider.generate({
          messages,
          model: dto.model,
        });
        return {
          ok: true,
          reply: result.text,
          provider: result.provider,
          requestedProvider: preferred,
          actualModel: result.actualModel,
          elapsedMs: Date.now() - startedAt,
          usedFallback: result.provider !== preferred,
          usedKnowledge,
          generatedAt: new Date().toISOString(),
        };
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "Unknown provider error";
        this.logger.warn(`AI Free provider ${name} failed: ${detail}`);
        errors.push(`${name}: ${detail}`);
        if (!allowFallback) throw error;
      }
    }

    throw new HttpException(
      {
        statusCode: HttpStatus.BAD_GATEWAY,
        message: "All free AI providers failed",
        errors: errors.slice(0, 5),
      },
      HttpStatus.BAD_GATEWAY,
    );
  }

  private defaultProviderName(): AiFreeProviderName {
    const configured = String(
      this.config.get("AI_FREE_DEFAULT_PROVIDER") || "llm7-free",
    ).trim() as AiFreeProviderName;
    if (this.providers.has(configured)) return configured;
    return "llm7-free";
  }

  private buildProviderOrder(
    preferred: AiFreeProviderName,
    allowFallback: boolean,
  ): AiFreeProviderName[] {
    const fallbackOrder: AiFreeProviderName[] = [
      "llm7-free",
      "pollinations-free",
      "browser-chatgpt",
    ];
    if (!allowFallback) return [preferred];
    return [
      preferred,
      ...fallbackOrder.filter((name) => name !== preferred),
    ].filter((name) => this.providers.has(name));
  }

  private assertRateLimit(userId: string) {
    const now = Date.now();
    const windowStart = now - 60000;
    const maximum = Math.min(
      Math.max(Number(this.config.get("AI_FREE_RATE_LIMIT_PER_MINUTE")) || 12, 1),
      60,
    );
    const recent = (this.rateBuckets.get(userId) || []).filter(
      (value) => value > windowStart,
    );
    if (recent.length >= maximum) {
      throw new HttpException(
        "Too many AI Free requests",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.rateBuckets.set(userId, recent);
  }
}
