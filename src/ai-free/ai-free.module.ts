import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AiFreeKnowledgeService } from "./ai-free-knowledge.service";
import { AiFreeController } from "./ai-free.controller";
import { AiFreeService } from "./ai-free.service";
import { AI_FREE_PROVIDER_LIST } from "./providers/ai-free-provider";
import { BrowserChatgptProvider } from "./providers/browser-chatgpt.provider";
import { Llm7FreeProvider } from "./providers/llm7-free.provider";
import { PollinationsFreeProvider } from "./providers/pollinations-free.provider";

@Module({
  imports: [ConfigModule],
  controllers: [AiFreeController],
  providers: [
    AiFreeKnowledgeService,
    Llm7FreeProvider,
    PollinationsFreeProvider,
    BrowserChatgptProvider,
    {
      provide: AI_FREE_PROVIDER_LIST,
      inject: [
        Llm7FreeProvider,
        PollinationsFreeProvider,
        BrowserChatgptProvider,
      ],
      useFactory: (
        llm7: Llm7FreeProvider,
        pollinations: PollinationsFreeProvider,
        browser: BrowserChatgptProvider,
      ) => [llm7, pollinations, browser],
    },
    AiFreeService,
  ],
  exports: [
    AiFreeService,
    AiFreeKnowledgeService,
    Llm7FreeProvider,
    PollinationsFreeProvider,
    BrowserChatgptProvider,
  ],
})
export class AiFreeModule {}
