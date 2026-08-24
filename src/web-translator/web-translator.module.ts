import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "entities/global.entity";
import { AiModule } from "../ai/ai.module";
import { AuthModule } from "../auth/auth.module";
import { MetaWhatsAppModule } from "../meta-whatsapp/meta-whatsapp.module";
import { WEB_TRANSLATOR_ENTITIES } from "./entities/web-translator.entity";
import { WebTranslatorController } from "./web-translator.controller";
import { WebTranslatorService } from "./web-translator.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([...WEB_TRANSLATOR_ENTITIES, User]),
    AuthModule,
    MetaWhatsAppModule,
    AiModule,
  ],
  controllers: [WebTranslatorController],
  providers: [WebTranslatorService],
  exports: [WebTranslatorService],
})
export class WebTranslatorModule {}
