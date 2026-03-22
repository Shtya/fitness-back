import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CalendarService } from './calendar.service';

@Injectable()
export class CalendarScheduler {
  constructor(private readonly calendarService: CalendarService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCalendarTick() {
    await this.calendarService.checkAndSendCalendarNotifications(new Date());
  }
}