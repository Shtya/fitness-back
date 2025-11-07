// src/modules/reminders/reminders.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reminder, UserReminderSettings, PushSubscription, NotificationLog } from 'entities/alert.entity';
import { RemindersService } from './reminder.service';
import { RemindersController } from './reminder.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Reminder, UserReminderSettings, PushSubscription, NotificationLog])],
  controllers: [RemindersController],
  providers: [RemindersService],
  exports: [RemindersService],
})
export class ReminderModule {}
