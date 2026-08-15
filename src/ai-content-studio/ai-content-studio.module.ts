import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiFreeModule } from '../ai-free/ai-free.module';
import { AiContentStudioController } from './ai-content-studio.controller';
import { AiContentStudioScheduler } from './ai-content-studio.scheduler';
import {
  AiContentStudioConfigEntity,
  AiContentStudioExecutionEntity,
  AiContentStudioSecretsEntity,
} from './entities/ai-content-studio.entity';
import { AI_CONTENT_PROVIDER_LIST } from './providers/ai-provider';
import { GeminiProvider } from './providers/gemini.provider';
import { GroqProvider } from './providers/groq.provider';
import { CloudflareProvider } from './providers/cloudflare.provider';
import { HuggingFaceProvider } from './providers/huggingface.provider';
import {
  CustomHttpProvider,
  OpenAICompatibleProvider,
} from './providers/openai-compatible.provider';
import { ComfyUIProvider } from './providers/comfyui.provider';
import {
  AiFreeChainStudioProvider,
  BrowserChatgptStudioProvider,
  Llm7FreeStudioProvider,
  PollinationsFreeImageStudioProvider,
  PollinationsFreeTextStudioProvider,
} from './providers/free-ai.studio.provider';
import { StudioCryptoService } from './services/studio-crypto.service';
import { StudioSecretsService } from './services/studio-secrets.service';
import { StudioMediaService } from './services/studio-media.service';
import { MetaPublishService } from './services/meta-publish.service';
import { ProviderManagerService } from './services/provider-manager.service';
import { DesignOverlayService } from './services/design-overlay.service';
import { PipelineService } from './services/pipeline.service';
import { KeyInspectorService } from './services/key-inspector.service';
import { TopicResearchService } from './services/topic-research.service';
import { BrowserFacebookPublisher } from './services/browser-facebook.publisher';
import { BrowserInstagramPublisher } from './services/browser-instagram.publisher';

@Module({
  imports: [
    ConfigModule,
    AiFreeModule,
    TypeOrmModule.forFeature([
      AiContentStudioSecretsEntity,
      AiContentStudioConfigEntity,
      AiContentStudioExecutionEntity,
    ]),
  ],
  controllers: [AiContentStudioController],
  providers: [
    GeminiProvider,
    GroqProvider,
    CloudflareProvider,
    HuggingFaceProvider,
    OpenAICompatibleProvider,
    CustomHttpProvider,
    ComfyUIProvider,
    AiFreeChainStudioProvider,
    Llm7FreeStudioProvider,
    PollinationsFreeTextStudioProvider,
    BrowserChatgptStudioProvider,
    PollinationsFreeImageStudioProvider,
    {
      provide: AI_CONTENT_PROVIDER_LIST,
      inject: [
        GeminiProvider,
        GroqProvider,
        CloudflareProvider,
        HuggingFaceProvider,
        OpenAICompatibleProvider,
        CustomHttpProvider,
        ComfyUIProvider,
        AiFreeChainStudioProvider,
        Llm7FreeStudioProvider,
        PollinationsFreeTextStudioProvider,
        BrowserChatgptStudioProvider,
        PollinationsFreeImageStudioProvider,
      ],
      useFactory: (
        gemini: GeminiProvider,
        groq: GroqProvider,
        cloudflare: CloudflareProvider,
        huggingface: HuggingFaceProvider,
        openaiCompat: OpenAICompatibleProvider,
        custom: CustomHttpProvider,
        comfyui: ComfyUIProvider,
        aiFree: AiFreeChainStudioProvider,
        llm7Free: Llm7FreeStudioProvider,
        pollinationsText: PollinationsFreeTextStudioProvider,
        browserChatgpt: BrowserChatgptStudioProvider,
        pollinationsImage: PollinationsFreeImageStudioProvider,
      ) => [
        aiFree,
        llm7Free,
        pollinationsText,
        browserChatgpt,
        pollinationsImage,
        gemini,
        groq,
        cloudflare,
        huggingface,
        openaiCompat,
        custom,
        comfyui,
      ],
    },
    StudioCryptoService,
    StudioSecretsService,
    KeyInspectorService,
    StudioMediaService,
    MetaPublishService,
    ProviderManagerService,
    DesignOverlayService,
    TopicResearchService,
    BrowserFacebookPublisher,
    BrowserInstagramPublisher,
    PipelineService,
    AiContentStudioScheduler,
  ],
  exports: [PipelineService, ProviderManagerService, StudioSecretsService],
})
export class AiContentStudioModule {}
