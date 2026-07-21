import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  WhatsAppDemoAttachment,
  WhatsAppDemoContact,
  WhatsAppDemoConversation,
  WhatsAppDemoEvent,
  WhatsAppDemoMessage,
  WhatsAppDemoProfile,
  WhatsAppDemoReaction,
  WhatsAppDemoSettings,
} from './entities/whatsapp-demo.entity';
import { WhatsAppDemoController } from './whatsapp-demo.controller';
import { WhatsAppDemoMediaController } from './whatsapp-demo-media.controller';
import { WhatsAppDemoService } from './whatsapp-demo.service';

export const WHATSAPP_DEMO_ENTITIES = [
  WhatsAppDemoSettings,
  WhatsAppDemoProfile,
  WhatsAppDemoContact,
  WhatsAppDemoConversation,
  WhatsAppDemoMessage,
  WhatsAppDemoAttachment,
  WhatsAppDemoReaction,
  WhatsAppDemoEvent,
];

@Module({
  imports: [TypeOrmModule.forFeature(WHATSAPP_DEMO_ENTITIES)],
  controllers: [WhatsAppDemoController, WhatsAppDemoMediaController],
  providers: [WhatsAppDemoService],
  exports: [WhatsAppDemoService],
})
export class WhatsAppDemoModule {}
