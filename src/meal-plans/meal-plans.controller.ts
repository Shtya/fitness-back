import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from 'entities/global.entity';
import { MealPlansService } from './meal-plans.service';

@Controller('meal-plans')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MealPlansController {
  constructor(private readonly svc: MealPlansService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async list(@Query() q: any) {
    return this.svc.list(q);
  }

  @Get('stats')
  async stats(@Query() q: any) {
    return this.svc.stats(q);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async create(@Body() dto: any) {
    return this.svc.create(dto);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.svc.getOneDeep(id);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async update(@Param('id') id: string, @Body() dto: any) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Post(':id/assign')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async assign(@Param('id') planId: string, @Body('userId') userId: string) {
    return this.svc.assignToUser(planId, userId);
  }

  @Post(':id/assign-bulk')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async bulkAssign(@Param('id') planId: string, @Body() dto: { athleteIds: string[] }) {
    return this.svc.bulkAssign(planId, dto);
  }

  @Get(':id/assignees')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async assignees(@Param('id') id: string) {
    return this.svc.listAssignees(id);
  }

  @Get('my/active')
  async getMyActive(@Req() req: any) {
    return this.svc.getActivePlan(req.user.id);
  }
}
