// weekly-report/weekly-report.controller.ts
import { Controller, Post, Get, Put, Delete, Body, Param, Query, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { WeeklyReportService } from './weekly-report.service';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { RolesGuard } from 'common/guards/roles.guard';
import { UserRole } from 'entities/global.entity';
import { Roles } from 'common/decorators/roles.decorator';
import { CRUD } from 'common/crud.service';

@Controller('weekly-reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WeeklyReportController {
  constructor(private readonly weeklyReportService: WeeklyReportService) {}

  @Post()
  @Roles(UserRole.CLIENT)
  async create(@Request() req, @Body() createDto: any) {
    return this.weeklyReportService.createReport(req.user.id, createDto);
  }

  @Get()
  async findAll(@Request() req, @Query() query, @Query('page') page = '1', @Query('limit') limit = '10', @Query('userId') userId?: string) {
    if (req.user.role === UserRole.CLIENT) {
      return this.weeklyReportService.findUserReports(req.user.id, Number(page), Number(limit));
    } else {
      return CRUD.findAll(this.weeklyReportService.weeklyReportRepo, 'p', query.search, query.page, query.limit, query.sortBy, query.sortOrder ?? 'DESC', ['user'], ['weekOf'], query.filters);
    }
  }

  @Get('coach')
  async findAllCoach(@Query() query: any, @Query('user_id') userId?: string) {
    const { search = '', page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'DESC', filters } = query ?? {};

    let parsedFilters: Record<string, any> = {};

    if (typeof filters === 'string') {
      try {
        parsedFilters = JSON.parse(filters);
      } catch {
        parsedFilters = {};
      }
    } else if (filters && typeof filters === 'object') {
      parsedFilters = { ...filters };
    }

    const known = new Set(['search', 'page', 'limit', 'sortBy', 'sortOrder', 'filters', 'userId']);
    for (const [k, v] of Object.entries(query || {})) {
      if (!known.has(k) && typeof v !== 'undefined') parsedFilters[k] = v;
    }

    if (userId) parsedFilters.coachId = userId;

    return CRUD.findAll(this.weeklyReportService.weeklyReportRepo, 'p', search, Number(page), Number(limit), sortBy, (sortOrder || 'DESC') as 'ASC' | 'DESC', [], ['weekOf'], parsedFilters);
  }

  // ✅ عدّاد التقارير غير المراجَعة للأدمن
  @Get('admin/unreviewed/count')
  @Roles(UserRole.ADMIN)
  async getAdminUnreviewedCount(@Request() req) {
    return this.weeklyReportService.countUnreviewedReportsForAdmin(req.user.id);
  }

  // ✅ عدّاد ملاحظات الكوتش غير المقروءة للعميل
  @Get('user/unread-feedback/count')
  @Roles(UserRole.CLIENT)
  async getUserUnreadFeedbackCount(@Request() req) {
    return this.weeklyReportService.countUnreadFeedbackForUser(req.user.id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req) {
    return this.weeklyReportService.findReportById(id, req.user);
  }

  @Get('admins/:adminId/clients')
  async getAdminClients(@Param('adminId') adminId: string, @Query() query: any) {
    if (!adminId) throw new BadRequestException('adminId required');
    return CRUD.findAll(this.weeklyReportService.weeklyReportRepo, 'p', query.search, query.page, query.limit, query.sortBy, query.sortOrder ?? 'DESC', ['user'], ['weekOf'], { adminId: adminId });
  }

  @Get('users/:userId/weekly-reports')
  async getUserReports(@Param('userId') userId: string, @Query() query: any) {
    return CRUD.findAll(this.weeklyReportService.weeklyReportRepo, 'p', query.search, query.page, query.limit, query.sortBy, query.sortOrder ?? 'DESC', [], ['weekOf'], { userId: userId });
  }

  // ✅ شلنا isRead من الـ DTO (العميل بس اللي يغيّر isRead)
  @Put(':id/feedback')
  @Roles(UserRole.COACH, UserRole.ADMIN)
  async updateFeedback(@Param('id') id: string, @Body() updateDto: { coachFeedback?: string }, @Request() req) {
    return this.weeklyReportService.updateFeedback(id, updateDto, req.user.id);
  }

  @Put(':id/read')
  @Roles(UserRole.CLIENT)
  async markAsRead(@Param('id') id: string, @Request() req) {
    return this.weeklyReportService.markAsRead(id, req.user.id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async remove(@Param('id') id: string) {
    return this.weeklyReportService.deleteReport(id);
  }

  @Get('user/stats')
  @Roles(UserRole.CLIENT)
  async getUserStats(@Request() req) {
    return this.weeklyReportService.getUserReportStats(req.user.id);
  }

  @Get('coach/athletes-reports')
  @Roles(UserRole.COACH, UserRole.ADMIN)
  async getAthletesReports(@Request() req, @Query('page') page = '1', @Query('limit') limit = '10') {
    return this.weeklyReportService.findAllReports(req.user, undefined, Number(page), Number(limit));
  }
}
