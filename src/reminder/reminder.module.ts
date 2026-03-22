import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Reminder, UserReminderSettings, PushSubscription, NotificationLog } from '../../entities/alert.entity';
import { User } from '../../entities/global.entity';
import { RemindersService } from './reminder.service';
import { RemindersController } from './reminder.controller';
import { RemindersScheduler } from './reminders.scheduler';
import { ReminderGateway } from './reminder.gateway';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reminder, UserReminderSettings, PushSubscription, NotificationLog, User]),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '7d' },
    }),
    NotificationModule,
  ],
  controllers: [RemindersController],
  providers: [RemindersService, RemindersScheduler, ReminderGateway],
  exports: [RemindersService, ReminderGateway],
})
export class ReminderModule {}