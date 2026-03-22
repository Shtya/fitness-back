import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification, User } from 'entities/global.entity';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { NotificationGateway } from './notification.gateway';
import { ExpoPushService } from './expo-push.service';
import { JwtService } from '@nestjs/jwt';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, User])],
  providers: [NotificationService, NotificationGateway, ExpoPushService , JwtService],
  controllers: [NotificationController],
  exports: [NotificationService, ExpoPushService],
})
export class NotificationModule {}