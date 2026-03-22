import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CalendarCompletion,
  CalendarEventType,
  CalendarItem,
  CalendarSettings,
  CommitmentTimer,
} from 'entities/calendar.entity';
import { User } from 'entities/global.entity';
import { CalendarService } from './calendar.service';
import { CalendarController } from './calendar.controller';
import { NotificationModule } from '../notification/notification.module';
import { CalendarScheduler } from './calendar.scheduler';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CalendarEventType,
      CalendarItem,
      CalendarCompletion,
      CalendarSettings,
      CommitmentTimer,
      User,
    ]),
    NotificationModule,
  ],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarScheduler],
  exports: [CalendarService],
})
export class CalendarModule {}