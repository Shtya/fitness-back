// src/plans/plans.controller.ts
import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards, BadRequestException, Req } from '@nestjs/common';
import { UserRole } from 'entities/global.entity';
import { AcceptPlanDto, ImportPlanDto, UpdatePlanDto } from './plans.dto';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { RolesGuard } from 'common/guards/roles.guard';
import { PlanService } from './plans.service';
import { Roles } from 'common/decorators/roles.decorator';

@Controller('plans')
export class PlanController {
  constructor(private readonly svc: PlanService) {}

  @Get('overview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async overview(@Req() req: any, @Query('page') page?: string, @Query('limit') limit?: string, @Query('search') search?: string, @Query('sortBy') sortBy?: string, @Query('sortOrder') sortOrder?: 'ASC' | 'DESC') {
    return this.svc.listPlansWithStats(
      {
        page: Number(page) || 1,
        limit: Math.min(Number(limit) || 12, 100),
        search: (search || '').trim(),
        sortBy: (sortBy as any) || 'created_at',
        sortOrder: sortOrder === 'ASC' ? 'ASC' : 'DESC',
      },
      { id: req.user.id, role: req.user.role },
    );
  }

  // IMPORT predefined plan(s) into DB -> associate with this admin
  @Post('import')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  importPlan(@Body() body: any, @Req() req: any) {
    return this.svc.importAndActivate(body, { id: req.user.id, role: req.user.role });
  }

  @Get('active')
  @UseGuards(JwtAuthGuard, RolesGuard)
  active(@Req() req: any) {
    return this.svc.getActivePlan(req.user.id);
  }

  // CREATE manual plan
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async create(@Body() body: any, @Req() req: any) {
    const dto = body?.payload ?? body;
    if (!dto?.name || !dto?.program) throw new BadRequestException('name and program are required');
    return this.svc.createPlanWithContent(dto, { id: req.user.id, role: req.user.role });
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  async list(@Query() q: any, @Req() req: any, @Query('user_id') user_id: any) {
    return this.svc.list(q, { id: user_id ?? req.user.id, role: req.user.role });
  }

  // GET one plan deep (must be allowed to see it)
  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: any) {
    return this.svc.getOneDeep(id);
  }

  // UPDATE plan (only owner admin or super admin)
  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async update(@Param('id') id: string, @Body() dto: UpdatePlanDto & any, @Req() req: any) {
    return this.svc.updatePlanAndContent(id, dto, { id: req.user.id, role: req.user.role });
  }

  // DELETE a plan (only owner admin or super admin)
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.remove(id, { id: req.user.id, role: req.user.role });
  }

  // ASSIGN plan to athletes
  @Post(':id/assign')
  @UseGuards(JwtAuthGuard, RolesGuard)
  // @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async bulkAssign(
    @Param('id') planId: string,
    @Req() req: any,
    @Body()
    dto: {
      athleteIds: string[];
      startDate?: string;
      endDate?: string;
      isActive?: boolean;
      confirm?: 'yes' | 'no';
      removeOthers?: boolean;
    },
  ) {
    dto.removeOthers = true;
    return this.svc.bulkAssign(planId, dto, { id: req.user.id, role: req.user.role });
  }

  @Get(':id/assignees')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async assignees(@Param('id') id: string) {
    return this.svc.listAssignees(id);
  }
}
