// --- File: plans/plans.controller.ts ---
import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards, BadRequestException } from '@nestjs/common';
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

  /** Import a weekly template (or compact) and optionally activate for a user */
  @Post('import')
  importPlan(@Body() body: ImportPlanDto) {
    return this.svc.importAndActivate(body);
  }

  /** User accepts an existing plan (activate it, deactivate others) */
  @Post('accept')
  accept(@Body() body: AcceptPlanDto) {
    if (!body?.planId || !body?.userId) {
      throw new BadRequestException('planId and userId are required');
    }
    return this.svc.acceptPlan(body.planId, body.userId);
  }

  /** Return the active plan for a user in FE shape */
  @Get('active')
  active(@Query('userId') userId: string) {
    return this.svc.getActivePlan(userId);
  }

  // Create plan + content (days/exercises)
   @Post()
  @Roles(UserRole.ADMIN, UserRole.CLIENT)
  async create(@Body() body: any) {
    const dto = body?.payload ?? body; // ← accept your current payload shape

    if (!dto?.name || !dto?.program) {
      throw new BadRequestException('name and program are required');
    }
    return this.svc.createPlanWithContent(dto);
  }

  // List plans (lightweight)
  @Get()
  async list(@Query() q: any) {
    return this.svc.list(q);
  }

  // One plan (deep)
  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.svc.getOneDeep(id);
  }

  // Update plan; if dto.program is provided, days/exercises are replaced
  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.CLIENT)
  async update(@Param('id') id: string, @Body() dto: UpdatePlanDto & any) {
    return this.svc.updatePlanAndContent(id, dto);
  }

  // Delete plan
  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.CLIENT)
  async remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  // Assign to many athletes
  @Post(':id/assign')
  @Roles(UserRole.ADMIN, UserRole.CLIENT)
  async bulkAssign(
    @Param('id') planId: string,
    @Body()
    dto: {
      athleteIds: string[];
      startDate?: string;
      endDate?: string;
      isActive?: boolean;
    },
  ) {
    return this.svc.bulkAssign(planId, dto);
  }

  // List assignees
  @Get(':id/assignees')
  async assignees(@Param('id') id: string) {
    return this.svc.listAssignees(id);
  }

  // Update a single assignment
  @Put('assignments/:assignmentId')
  @Roles(UserRole.ADMIN, UserRole.CLIENT)
  async updateAssignment(@Param('assignmentId') assignmentId: string, @Body() dto: any) {
    return this.svc.updateAssignment(assignmentId, dto);
  }

  // Delete a single assignment
  @Delete('assignments/:assignmentId')
  @Roles(UserRole.ADMIN, UserRole.CLIENT)
  async deleteAssignment(@Param('assignmentId') assignmentId: string) {
    return this.svc.deleteAssignment(assignmentId);
  }
}
