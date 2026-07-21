import { AiReplyProviderName } from "../entities/whatsapp-ai-settings.entity";

export interface AiReplyProviderRequest {
  prompt: string;
  model: string;
}

export interface AiReplyProviderResult {
  text: string;
  actualModel: string | null;
}

export interface AiReplyProvider {
  readonly name: AiReplyProviderName;
  generate(request: AiReplyProviderRequest): Promise<AiReplyProviderResult>;
}

export const AI_REPLY_PROVIDER_LIST = Symbol("AI_REPLY_PROVIDER_LIST");
