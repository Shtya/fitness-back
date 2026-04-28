// weekly-report/coach-report.controller.ts
import { Controller, Get, Put, Post, Body, Request, UseGuards, Query } from '@nestjs/common';
import { WeeklyReportService } from './weekly-report.service';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { RolesGuard } from 'common/guards/roles.guard';
import { Roles } from 'common/decorators/roles.decorator';
import { UserRole } from 'entities/global.entity';

@Controller('coach')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.COACH, UserRole.ADMIN)
export class CoachReportController {
  constructor(private readonly weeklyReportService: WeeklyReportService) {}

  /**
   * Resolve the config owner ID:
   * - ADMIN → their own ID (they ARE the gym owner)
   * - COACH → their adminId so all coaches share the gym config
   */
  private resolveOwnerId(user: any): string {
    return user.role === UserRole.ADMIN ? user.id : (user.adminId || user.id);
  }

  @Get('report-config')
  async getConfig(@Request() req) {
    return this.weeklyReportService.getReportConfig(this.resolveOwnerId(req.user));
  }

  @Put('report-config')
  async saveConfig(@Request() req, @Body() body: any) {
    return this.weeklyReportService.saveReportConfig(this.resolveOwnerId(req.user), body);
  }

  @Get('clients/report-status')
  async getClientsStatus(
    @Request() req,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search = '',
    @Query('status') statusFilter = '',
  ) {
    return this.weeklyReportService.getClientsReportStatus(
      this.resolveOwnerId(req.user),
      req.user.role,
      Number(page) || 1,
      Number(limit) || 20,
      search,
      statusFilter,
    );
  }

  @Post('report-reminder')
  async sendReminder(@Request() req, @Body() body: { clientIds: string[] }) {
    const locale = String(req?.headers?.['x-locale'] || req?.headers?.['accept-language'] || 'ar');
    return this.weeklyReportService.sendReminderToClients(body.clientIds || [], locale);
  }
}
