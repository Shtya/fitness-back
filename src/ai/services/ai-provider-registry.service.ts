import { Inject, Injectable } from '@nestjs/common';
import { AiException } from '../ai.errors';
import { HttpStatus } from '@nestjs/common';
import { AI_PROVIDERS_TOKEN } from '../ai.constants';
import { AiProvider } from '../providers/ai-provider.interface';
import { AiModelType } from '../ai.constants';

@Injectable()
export class AiProviderRegistryService {
	private readonly byId = new Map<string, AiProvider>();

	constructor(@Inject(AI_PROVIDERS_TOKEN) providers: AiProvider[]) {
		for (const provider of providers || []) {
			this.byId.set(provider.id, provider);
		}
	}

	list() {
		return Array.from(this.byId.values());
	}

	get(id: string): AiProvider {
		const provider = this.byId.get(String(id || '').trim());
		if (!provider) {
			throw new AiException(
				'AI_PROVIDER_UNAVAILABLE',
				`Provider "${id}" is not implemented yet. Add it to the AI module provider registry.`,
				HttpStatus.BAD_REQUEST,
			);
		}
		return provider;
	}

	requireCapability(id: string, type: AiModelType): AiProvider {
		const provider = this.get(id);
		if (!provider.supports(type)) {
			throw new AiException(
				'AI_PROVIDER_UNAVAILABLE',
				`Provider "${id}" does not support ${type} generation.`,
				HttpStatus.BAD_REQUEST,
			);
		}
		return provider;
	}
}
