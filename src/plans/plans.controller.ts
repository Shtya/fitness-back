// src/plans/plans.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PlansService } from './plans.service';
import { DayOfWeek } from 'entities/global.entity';

@Controller('plans')
export class PlansController {
  constructor(private readonly svc: PlansService) {}

  @Post()
  async create(@Body() body: { name: string; userId: string; coachId?: string | null; active?: boolean; weekly: Partial<Record<DayOfWeek, { id: string; name: string; exercises: any[] }>>; metadata?: Record<string, any> }) {
    return this.svc.createFromSeed(body);
  }

  @Get('active')
  async active(@Query('userId') userId: string) {
    return this.svc.getActive(userId);
  }

  @Patch(':planId/active')
  async setActive(@Param('planId') planId: string, @Body() body: { isActive: boolean }) {
    return this.svc.setActive(planId, body.isActive);
  }

  @Patch(':planId/day/:dayId/exercise/:exerciseId/media')
  async updateMedia(@Param('planId') planId: string, @Param('dayId') dayId: string, @Param('exerciseId') exerciseId: string, @Body() patch: { img?: string | null; video?: string | null; desc?: string | null }) {
    return this.svc.updateExerciseMedia(planId, dayId, exerciseId, patch);
  }

  // plans.controller.ts
  @Patch(':planId/reassign')
  async reassign(@Param('planId') planId: string, @Body() body: { newUserId?: string; newCoachId?: string | null; setActiveForNewUser?: boolean }) {
    return await this.svc.reassign(planId, body);
  }

  @Patch(':planId/day/:dayId/reorder')
  async reorder(@Param('planId') planId: string, @Param('dayId') dayId: string, @Body('ids') ids: string[]) {
    return this.svc.reorderDayExercises(planId, dayId, ids);
  }

  @Patch(':planId/days')
  async upsertDays(@Param('planId') planId: string, @Body() dto: any) {
    return this.svc.upsertDays(planId, dto);
  }

  @Delete(':planId/day/:dayId')
  async removeDay(@Param('planId') planId: string, @Param('dayId') dayId: string) {
    return this.svc.deleteDay(planId, dayId);
  }
}
