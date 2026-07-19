import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification, User } from 'entities/global.entity';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { NotificationGateway } from './notification.gateway';
import { ExpoPushService } from './expo-push.service';
import { NotificationScheduler } from './notification.scheduler';
import { JwtService } from '@nestjs/jwt';
import { PushSubscription } from '../../entities/alert.entity';
import { WebPushService } from './web-push.service';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, User, PushSubscription])],
  providers: [NotificationService, NotificationGateway, ExpoPushService, WebPushService, NotificationScheduler, JwtService],
  controllers: [NotificationController],
  exports: [NotificationService, ExpoPushService, WebPushService],
})
export class NotificationModule {}