import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AI_ENTITIES } from './entities/ai.entity';
import { AI_PROVIDERS_TOKEN } from './ai.constants';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { GeminiAiProvider } from './providers/gemini.provider';
import { AiCryptoService } from './services/ai-crypto.service';
import { AiCredentialsService } from './services/ai-credentials.service';
import { AiModelRegistryService } from './services/ai-model-registry.service';
import { AiProviderRegistryService } from './services/ai-provider-registry.service';
import { AiLimitsService } from './services/ai-limits.service';
import { AiRouterService } from './services/ai-router.service';

@Module({
	imports: [ConfigModule, TypeOrmModule.forFeature(AI_ENTITIES)],
	controllers: [AiController],
	providers: [
		GeminiAiProvider,
		{
			provide: AI_PROVIDERS_TOKEN,
			inject: [GeminiAiProvider],
			useFactory: (gemini: GeminiAiProvider) => [gemini],
		},
		AiCryptoService,
		AiCredentialsService,
		AiModelRegistryService,
		AiProviderRegistryService,
		AiRouterService,
		AiLimitsService,
		AiService,
	],
	exports: [AiService],
})
export class AiModule {}
