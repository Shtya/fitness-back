import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatMessage, ChatParticipant, Notification, User } from 'entities/global.entity';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { NotificationGateway } from './notification.gateway';
import { ExpoPushService } from './expo-push.service';
import { BadgeService } from './badge.service';
import { NotificationScheduler } from './notification.scheduler';
import { JwtService } from '@nestjs/jwt';
import { PushSubscription } from '../../entities/alert.entity';
import { WebPushService } from './web-push.service';
import { RestTimerPushService } from './rest-timer-push.service';
import { RestTimerPushController } from './rest-timer-push.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, User, PushSubscription, ChatMessage, ChatParticipant])],
  providers: [NotificationService, NotificationGateway, ExpoPushService, BadgeService, WebPushService, RestTimerPushService, NotificationScheduler, JwtService],
  controllers: [RestTimerPushController, NotificationController],
  exports: [NotificationService, ExpoPushService, BadgeService, WebPushService],
})
export class NotificationModule {}
