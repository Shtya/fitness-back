export type EmailMemoAiResult = {
	text: string;
	provider: string;
	model: string;
};

export type EmailMemoAiInput = {
	system: string;
	prompt: string;
	model?: string | null;
	maxTokens?: number;
	temperature?: number;
};

export interface EmailMemoAiProvider {
	readonly id: string;
	readonly label: string;
	isConfigured(): boolean;
	generate(input: EmailMemoAiInput): Promise<EmailMemoAiResult>;
}

export const EMAIL_MEMO_AI_PROVIDERS = Symbol('EMAIL_MEMO_AI_PROVIDERS');
