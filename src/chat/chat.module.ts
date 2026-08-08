import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatPushService } from './chat-push.service';
import { ChatConversation, ChatMessage, ChatParticipant, User, Feedback } from 'entities/global.entity';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatConversation, ChatMessage, ChatParticipant, User, Feedback]),
    NotificationModule,
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
      }),
    }),
  ],
  providers: [ChatGateway, ChatService, ChatPushService],
  controllers: [ChatController],
  exports: [ChatService, ChatPushService],
})
export class ChatModule {}
