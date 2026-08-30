export type AiFreeProviderName =
  | "llm7-free"
  | "browser-chatgpt"
  | "pollinations-free";

export interface AiFreeChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiFreeProviderRequest {
  messages: AiFreeChatMessage[];
  model?: string;
  maxTokens?: number;
}

export interface AiFreeProviderResult {
  text: string;
  provider: AiFreeProviderName;
  actualModel: string | null;
}

export interface AiFreeProvider {
  readonly name: AiFreeProviderName;
  readonly label: string;
  readonly description: string;
  generate(request: AiFreeProviderRequest): Promise<AiFreeProviderResult>;
}

export const AI_FREE_PROVIDER_LIST = Symbol("AI_FREE_PROVIDER_LIST");
