import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards, BadRequestException, Req } from '@nestjs/common';
import { UserRole } from 'entities/global.entity';
import { AcceptPlanDto, ImportPlanDto, UpdatePlanDto } from './plans.dto';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { RolesGuard } from 'common/guards/roles.guard';
import { PlanService } from './plans.service';
import { Roles } from 'common/decorators/roles.decorator';

@Controller('plans')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PlanController {
  constructor(private readonly svc: PlanService) {}

  @Get('overview')
  async overview(@Query('page') page?: string, @Query('limit') limit?: string, @Query('search') search?: string, @Query('sortBy') sortBy?: string, @Query('sortOrder') sortOrder?: 'ASC' | 'DESC') {
    return this.svc.listPlansWithStats({
      page: Number(page) || 1,
      limit: Math.min(Number(limit) || 12, 100),
      search: (search || '').trim(),
      sortBy: (sortBy as any) || 'created_at',
      sortOrder: sortOrder === 'ASC' ? 'ASC' : 'DESC',
    });
  }

  @Post('import')
  importPlan(@Body() body: any) {
    return this.svc.importAndActivate(body);
  }

  @Get('active')
  active(@Query('userId') userId: string ,@Req() req :any ) {
    return this.svc.getActivePlan(req.user.id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.CLIENT)
  async create(@Body() body: any) {
    const dto = body?.payload ?? body;

    if (!dto?.name || !dto?.program) {
      throw new BadRequestException('name and program are required');
    }
    return this.svc.createPlanWithContent(dto);
  }

  @Get()
  async list(@Query() q: any) {
    return this.svc.list(q);
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.svc.getOneDeep(id);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.CLIENT)
  async update(@Param('id') id: string, @Body() dto: UpdatePlanDto & any) {
    return this.svc.updatePlanAndContent(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.CLIENT)
  async remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Post(':id/assign')
  @Roles(UserRole.ADMIN, UserRole.CLIENT)
  async bulkAssign(
    @Param('id') planId: string,
		@Req() req :any ,
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
    return this.svc.bulkAssign(planId, dto , req.user.id);
  }

  @Get(':id/assignees')
  async assignees(@Param('id') id: string) {
    return this.svc.listAssignees(id);
  }

	
}
