// weekly-report/weekly-report.controller.ts
import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { WeeklyReportService } from './weekly-report.service';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { RolesGuard } from 'common/guards/roles.guard';
import { UserRole } from 'entities/global.entity';
import { Roles } from 'common/decorators/roles.decorator';
 

@Controller('weekly-reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WeeklyReportController {
  constructor(private readonly weeklyReportService: WeeklyReportService) {}

  @Post()
  @Roles(UserRole.CLIENT)
  async create(
    @Request() req,
    @Body() createDto: any,
  ) {
    return this.weeklyReportService.createReport(req.user.id, createDto);
  }

  @Get()
  async findAll(
    @Request() req,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('userId') userId?: string,
  ) {
    // Clients can only see their own reports
    // Coaches/Admins can see reports from their athletes or all reports
    if (req.user.role === UserRole.CLIENT) {
      return this.weeklyReportService.findUserReports(
        req.user.id,
        Number(page),
        Number(limit),
      );
    } else {
      return this.weeklyReportService.findAllReports(
        req.user,
        userId,
        Number(page),
        Number(limit),
      );
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req) {
    return this.weeklyReportService.findReportById(id, req.user);
  }

  @Put(':id/feedback')
  @Roles(UserRole.COACH, UserRole.ADMIN)
  async updateFeedback(
    @Param('id') id: string,
    @Body() updateDto: { coachFeedback?: string; isRead?: boolean },
    @Request() req,
  ) {
    return this.weeklyReportService.updateFeedback(
      id,
      updateDto,
      req.user.id,
    );
  }

  @Put(':id/read')
  @Roles(UserRole.CLIENT)
  async markAsRead(
    @Param('id') id: string,
    @Request() req,
  ) {
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
  async getAthletesReports(
    @Request() req,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
  ) {
    return this.weeklyReportService.findAllReports(
      req.user,
      undefined,
      Number(page),
      Number(limit),
    );
  }
}