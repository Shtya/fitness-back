import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  WhatsAppConversation,
  WhatsAppMessage,
} from "../whatsapp/entities/whatsapp.entity";
import { WhatsAppModule } from "../whatsapp/whatsapp.module";
import { AiReplySuggestionsController } from "./ai-reply-suggestions.controller";
import { WhatsAppAiSettings } from "./entities/whatsapp-ai-settings.entity";
import { AI_REPLY_PROVIDER_LIST } from "./providers/ai-reply-provider";
import { AiReplyProviderRegistry } from "./providers/ai-reply-provider.registry";
import { DragifyFreeProvider } from "./providers/dragify-free.provider";
import { AiReplyContextService } from "./services/ai-reply-context.service";
import { AiReplySuggestionsService } from "./services/ai-reply-suggestions.service";

@Module({
  imports: [
    ConfigModule,
    WhatsAppModule,
    TypeOrmModule.forFeature([
      WhatsAppAiSettings,
      WhatsAppConversation,
      WhatsAppMessage,
    ]),
  ],
  controllers: [AiReplySuggestionsController],
  providers: [
    DragifyFreeProvider,
    {
      provide: AI_REPLY_PROVIDER_LIST,
      inject: [DragifyFreeProvider],
      useFactory: (dragifyFree: DragifyFreeProvider) => [dragifyFree],
    },
    AiReplyProviderRegistry,
    AiReplyContextService,
    AiReplySuggestionsService,
  ],
  exports: [AiReplySuggestionsService],
})
export class AiReplySuggestionsModule {}
