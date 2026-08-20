import { Injectable } from '@nestjs/common';
import { AiModelType } from '../ai.constants';
import { AiModelRegistryService } from './ai-model-registry.service';
import { AiProviderRegistryService } from './ai-provider-registry.service';

@Injectable()
export class AiRouterService {
	constructor(
		private readonly models: AiModelRegistryService,
		private readonly providers: AiProviderRegistryService,
	) {}

	async route(workspaceId: string, type: AiModelType, modelKey?: string) {
		const model = await this.models.resolve(workspaceId, type, modelKey);
		const provider = this.providers.requireCapability(model.provider, type);
		return { model, provider };
	}
}
