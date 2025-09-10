// src/planning/planning.controller.ts
import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { PlanningService } from './planning.service';

@Controller('plans')
export class PlanningController {
  constructor(private readonly svc: PlanningService) {}

  @Get('active')
  async getActivePlan(@Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException('userId is required');
    return this.svc.getActivePlanForUser(userId);
  }
}
