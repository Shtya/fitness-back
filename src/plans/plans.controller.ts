import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { PlansService } from './plans.service';
import { CreatePlanDto, ImportPlanDto, AcceptPlanDto } from './plans.dto';
@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  /** Import JSON (weeklyProgram or compact) and activate it for the user */
  @Post('import')
  importPlan(@Body() body: any) {
    return this.plansService.importAndActivate(body);
  }

  /** User accepts an existing plan (activate it, deactivate others) */
  @Post('accept')
  accept(@Body() body: AcceptPlanDto) {
    return this.plansService.acceptPlan(body.planId, body.userId);
  }

  /** Return active plan in FE shape your page expects */
  @Get('active')
  active(@Query('userId') userId: string) {
    return this.plansService.getActivePlan(userId);
  }
}
