import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { FeedbackStatus } from 'entities/global.entity';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from 'entities/global.entity';

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}
 
  @Post()
  async createFeedback(@Body() createFeedbackDto: CreateFeedbackDto, @Req() req: any) {
    const userId = req.user?.id || null;
    return this.feedbackService.createFeedback(createFeedbackDto, userId);
  }

  /**
   * Get all feedbacks (super_admin only)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Get()
  async getAllFeedbacks(
    @Query('skip') skip: string = '0',
    @Query('take') take: string = '50',
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
  ) {
    return this.feedbackService.getAllFeedbacks(
      parseInt(skip, 10),
      parseInt(take, 10),
      type,
      status,
      userId,
    );
  }

  /**
   * Get feedback statistics (super_admin only)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Get('stats/overview')
  async getFeedbackStats() {
    return this.feedbackService.getFeedbackStats();
  }

  /**
   * Get feedback by ID (super_admin only)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Get(':id')
  async getFeedbackById(@Param('id') id: string) {
    return this.feedbackService.getFeedbackById(id);
  }

  /**
   * Update feedback status (super_admin only)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Patch(':id/status')
  async updateFeedbackStatus(@Param('id') id: string, @Body('status') status: FeedbackStatus) {
    return this.feedbackService.updateFeedbackStatus(id, status);
  }

  /**
   * Delete feedback (super_admin only)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Delete(':id')
  async deleteFeedback(@Param('id') id: string) {
    return this.feedbackService.deleteFeedback(id);
  }
}
