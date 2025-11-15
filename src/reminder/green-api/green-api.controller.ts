// src/modules/green-api/green-api.controller.ts
import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { GreenApiService } from './green-api.service';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';

@Controller('green-api')
@UseGuards(JwtAuthGuard)
export class GreenApiController {
  constructor(private readonly greenApiService: GreenApiService) {}

  @Post('send-message')
  async sendMessage(@Body() body: { phoneNumber: string; message: string }) {
    return this.greenApiService.sendMessage(body.phoneNumber, body.message);
  }

  @Get('account-state')
  async getAccountState() {
    return this.greenApiService.getAccountState();
  }

  @Post('test-reminder')
  async testReminder(@Body() body: { phoneNumber: string }) {
    const testReminder = {
      title: 'Test Reminder',
      description: 'This is a test reminder from your app',
      type: 'test',
      schedule: { times: ['14:30'] },
    };

    const message = this.greenApiService.formatReminderMessage(testReminder);
    return this.greenApiService.sendMessage(body.phoneNumber, message);
  }
}
