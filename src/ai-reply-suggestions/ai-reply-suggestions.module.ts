import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AiFreeModule } from "../ai-free/ai-free.module";
import {
  WhatsAppConversation,
  WhatsAppMessage,
} from "../whatsapp/entities/whatsapp.entity";
import { WhatsAppModule } from "../whatsapp/whatsapp.module";
import { AiReplySuggestionsController } from "./ai-reply-suggestions.controller";
import { WhatsAppAiSettings } from "./entities/whatsapp-ai-settings.entity";
import { AI_REPLY_PROVIDER_LIST } from "./providers/ai-reply-provider";
import {
  AiFreeChainAiReplyProvider,
  BrowserChatgptAiReplyProvider,
  DragifyFreeCompatAiReplyProvider,
  Llm7AiReplyProvider,
  PollinationsAiReplyProvider,
} from "./providers/ai-free-reply.adapters";
import { AiReplyProviderRegistry } from "./providers/ai-reply-provider.registry";
import { AiReplyContextService } from "./services/ai-reply-context.service";
import { AiReplySuggestionsService } from "./services/ai-reply-suggestions.service";

@Module({
  imports: [
    ConfigModule,
    AiFreeModule,
    WhatsAppModule,
    TypeOrmModule.forFeature([
      WhatsAppAiSettings,
      WhatsAppConversation,
      WhatsAppMessage,
    ]),
  ],
  controllers: [AiReplySuggestionsController],
  providers: [
    AiFreeChainAiReplyProvider,
    DragifyFreeCompatAiReplyProvider,
    Llm7AiReplyProvider,
    PollinationsAiReplyProvider,
    BrowserChatgptAiReplyProvider,
    {
      provide: AI_REPLY_PROVIDER_LIST,
      inject: [
        AiFreeChainAiReplyProvider,
        DragifyFreeCompatAiReplyProvider,
        Llm7AiReplyProvider,
        PollinationsAiReplyProvider,
        BrowserChatgptAiReplyProvider,
      ],
      useFactory: (
        aiFree: AiFreeChainAiReplyProvider,
        dragifyCompat: DragifyFreeCompatAiReplyProvider,
        llm7: Llm7AiReplyProvider,
        pollinations: PollinationsAiReplyProvider,
        browser: BrowserChatgptAiReplyProvider,
      ) => [aiFree, dragifyCompat, llm7, pollinations, browser],
    },
    AiReplyProviderRegistry,
    AiReplyContextService,
    AiReplySuggestionsService,
  ],
  exports: [AiReplySuggestionsService],
})
export class AiReplySuggestionsModule {}
