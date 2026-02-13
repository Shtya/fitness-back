// src/modules/calendar/calendar.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CalendarCompletion,
  CalendarEventType,
  CalendarItem,
  CalendarSettings,
  CommitmentTimer,
} from 'entities/calendar.entity';
import { CalendarService } from './calendar.service';
import { CalendarController } from './calendar.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CalendarEventType,
      CalendarItem,
      CalendarCompletion,
      CalendarSettings,
      CommitmentTimer,
    ]),
  ],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
