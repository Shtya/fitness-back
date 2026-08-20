import { AiModelType } from '../ai.constants';

export type AiProviderCredentials = {
	apiKey: string;
};

export type AiTextGenerateInput = {
	prompt: string;
	model: string;
	system?: string;
	maxTokens?: number;
	temperature?: number;
};

export type AiTextGenerateResult = {
	text: string;
	model: string;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
};

export type AiImageGenerateInput = {
	prompt: string;
	model: string;
	aspectRatio?: string;
};

export type AiImageGenerateResult = {
	imageUrl: string;
	mimeType: string;
	model: string;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	imageCount: number;
};

export type AiConnectionTestResult = {
	ok: boolean;
	message: string;
};

export interface AiProvider {
	readonly id: string;
	readonly name: string;
	supports(type: AiModelType): boolean;
	testConnection(credentials: AiProviderCredentials): Promise<AiConnectionTestResult>;
	generateText?(
		input: AiTextGenerateInput,
		credentials: AiProviderCredentials,
	): Promise<AiTextGenerateResult>;
	generateImage?(
		input: AiImageGenerateInput,
		credentials: AiProviderCredentials,
	): Promise<AiImageGenerateResult>;
}
