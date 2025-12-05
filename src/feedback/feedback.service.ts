import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Feedback, FeedbackStatus } from 'entities/global.entity';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

@Injectable()
export class FeedbackService {
  constructor(
    @InjectRepository(Feedback)
    private readonly feedbackRepo: Repository<Feedback>,
  ) {}

  /**
   * Create new feedback
   */
  async createFeedback(createFeedbackDto: CreateFeedbackDto, userId?: string) {
    try {
      const feedback = this.feedbackRepo.create({
        type: createFeedbackDto.type,
        title: createFeedbackDto.title,
        description: createFeedbackDto.description,
        email: createFeedbackDto.email || null,
        userId: userId || null,
        status: FeedbackStatus.NEW,
      });

      await this.feedbackRepo.save(feedback);

      return {
        success: true,
        message: 'Feedback submitted successfully',
        data: feedback,
      };
    } catch (error) {
      throw new BadRequestException('Failed to create feedback: ' + error.message);
    }
  }

  /**
   * Get all feedbacks with optional filters
   */
  async getAllFeedbacks(
    skip: number = 0,
    take: number = 50,
    type?: string,
    status?: string,
    userId?: string,
  ) {
    const query = this.feedbackRepo.createQueryBuilder('feedback');

    if (type) {
      query.andWhere('feedback.type = :type', { type });
    }

    if (status) {
      query.andWhere('feedback.status = :status', { status });
    }

    if (userId) {
      query.andWhere('feedback.userId = :userId', { userId });
    }

    query.orderBy('feedback.created_at', 'DESC').skip(skip).take(take);

    const [data, total] = await query.getManyAndCount();

    return {
      success: true,
      data,
      pagination: {
        total,
        skip,
        take,
        pages: Math.ceil(total / take),
      },
    };
  }

  /**
   * Get feedback by ID
   */
  async getFeedbackById(id: string) {
    const feedback = await this.feedbackRepo.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!feedback) {
      throw new BadRequestException('Feedback not found');
    }

    return {
      success: true,
      data: feedback,
    };
  }

  /**
   * Update feedback status
   */
  async updateFeedbackStatus(id: string, status: FeedbackStatus) {
    const feedback = await this.feedbackRepo.findOne({ where: { id } });

    if (!feedback) {
      throw new BadRequestException('Feedback not found');
    }

    feedback.status = status;
    await this.feedbackRepo.save(feedback);

    return {
      success: true,
      message: 'Feedback status updated successfully',
      data: feedback,
    };
  }

  /**
   * Delete feedback (soft delete)
   */
  async deleteFeedback(id: string) {
    const feedback = await this.feedbackRepo.findOne({ where: { id } });

    if (!feedback) {
      throw new BadRequestException('Feedback not found');
    }

    await this.feedbackRepo.softDelete(id);

    return {
      success: true,
      message: 'Feedback deleted successfully',
    };
  }

  /**
   * Get feedback statistics
   */
  async getFeedbackStats() {
    const stats = await this.feedbackRepo
      .createQueryBuilder('feedback')
      .select('feedback.type', 'type')
      .addSelect('feedback.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('feedback.type, feedback.status')
      .orderBy('COUNT(*)', 'DESC')
      .getRawMany();

    const totalCount = await this.feedbackRepo.count();

    return {
      success: true,
      data: {
        total: totalCount,
        stats,
      },
    };
  }
}
