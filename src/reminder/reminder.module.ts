// src/modules/reminders/reminder.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { HttpModule } from '@nestjs/axios'; // Add this import
import { Reminder, UserReminderSettings, PushSubscription, NotificationLog } from '../../entities/alert.entity';
import { User } from '../../entities/global.entity';
import { RemindersService } from './reminder.service';
import { RemindersController } from './reminder.controller';
import { RemindersScheduler } from './reminders.scheduler';
import { ReminderGateway } from './reminder.gateway';
import { GreenApiService } from './green-api/green-api.service'; // Import service directly

@Module({
  imports: [
    TypeOrmModule.forFeature([Reminder, UserReminderSettings, PushSubscription, NotificationLog, User]),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '7d' },
    }),
    HttpModule, // Add HttpModule here
  ],
  controllers: [RemindersController],
  providers: [
    RemindersService,
    RemindersScheduler,
    ReminderGateway,
    GreenApiService, // Add GreenApiService as provider
  ],
  exports: [RemindersService, ReminderGateway],
})
export class ReminderModule {}
