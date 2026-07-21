import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { AiReplyProviderName } from "../entities/whatsapp-ai-settings.entity";
import { AI_REPLY_PROVIDER_LIST, AiReplyProvider } from "./ai-reply-provider";

@Injectable()
export class AiReplyProviderRegistry {
  private readonly providers: Map<string, AiReplyProvider>;

  constructor(
    @Inject(AI_REPLY_PROVIDER_LIST)
    providers: AiReplyProvider[],
  ) {
    this.providers = new Map(
      providers.map((provider) => [provider.name, provider]),
    );
  }

  get(name: AiReplyProviderName): AiReplyProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new BadRequestException(
        "Configured AI reply provider is not available",
      );
    }
    return provider;
  }
}
