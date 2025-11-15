// src/modules/reminders/reminders.scheduler.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RemindersService } from './reminder.service';
import { ReminderGateway } from './reminder.gateway';

@Injectable()
export class RemindersScheduler implements OnModuleInit {
  constructor(
    private readonly remindersService: RemindersService,
    private readonly reminderGateway: ReminderGateway,
  ) {}

  onModuleInit() {
    // Inject gateway into service after module initialization
    this.remindersService.setReminderGateway(this.reminderGateway);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleRemindersTick() {
    await this.remindersService.processDueReminders(new Date());
  }
}
