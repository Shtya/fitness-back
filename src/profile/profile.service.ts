import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual } from 'typeorm';
import { ProgressPhoto, BodyMeasurement } from 'entities/profile.entity';
import { User } from 'entities/global.entity';
import { CreateProgressPhotoDto, CreateBodyMeasurementDto, UpdateBodyMeasurementDto, TimelineQueryDto } from 'dto/profile.dto';

@Injectable()
export class ProfileService {
  constructor(
    @InjectRepository(ProgressPhoto)
    public progressPhotoRepo: Repository<ProgressPhoto>,

    @InjectRepository(BodyMeasurement)
    public bodyMeasurementRepo: Repository<BodyMeasurement>,

    @InjectRepository(User)
    public userRepo: Repository<User>,
  ) {}

  // Progress Photos Methods
  async createProgressPhoto(userId: string, dto: CreateProgressPhotoDto): Promise<ProgressPhoto> {
    const photo = this.progressPhotoRepo.create({
      userId,
      ...dto,
    });

    return await this.progressPhotoRepo.save(photo);
  }

  async getProgressPhotosTimeline(userId: string, query: TimelineQueryDto) {
    const dateThreshold = new Date();
    dateThreshold.setMonth(dateThreshold.getMonth() - (query.months || 12));

    const photos = await this.progressPhotoRepo.find({
      where: {
        userId,
        takenAt: MoreThanOrEqual(dateThreshold.toISOString().split('T')[0]),
      },
      order: { takenAt: 'DESC' },
    });

    // Group by month for timeline view
    const timeline = photos.reduce((acc, photo) => {
      const date = new Date(photo.takenAt);
      const monthKey = date.toLocaleString('default', { month: 'short', year: 'numeric' });

      if (!acc[monthKey]) {
        acc[monthKey] = {
          id: photo.id,
          month: monthKey,
          weight: photo.weight,
          note: photo.note,
          sides: photo.sides,
        };
      }

      return acc;
    }, {});

    return Object.values(timeline);
  }

  async getProgressPhoto(id: string, userId: string): Promise<ProgressPhoto> {
    const photo = await this.progressPhotoRepo.findOne({ where: { id, userId } });
    if (!photo) {
      throw new NotFoundException('Progress photo not found');
    }
    return photo;
  }

  async deleteProgressPhoto(id: string, userId: string): Promise<void> {
    const result = await this.progressPhotoRepo.delete({ id, userId });
    if (result.affected === 0) {
      throw new NotFoundException('Progress photo not found');
    }
  }

  // Body Measurements Methods
  async createBodyMeasurement(userId: string, dto: CreateBodyMeasurementDto): Promise<BodyMeasurement> {
    // Check if measurement already exists for this date
    const existing = await this.bodyMeasurementRepo.findOne({
      where: { userId, date: dto.date },
    });

    if (existing) {
      // Update existing measurement
      Object.assign(existing, dto);
      return await this.bodyMeasurementRepo.save(existing);
    }

    const measurement = this.bodyMeasurementRepo.create({
      userId,
      ...dto,
    });

    return await this.bodyMeasurementRepo.save(measurement);
  }

  async getBodyMeasurements(userId: string, days: number = 120) {
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - days);

    return await this.bodyMeasurementRepo.find({
      where: {
        userId,
        date: MoreThanOrEqual(dateThreshold.toISOString().split('T')[0]),
      },
      order: { date: 'ASC' },
    });
  }

  async getLatestBodyMeasurement(userId: string): Promise<BodyMeasurement | null> {
    return await this.bodyMeasurementRepo.findOne({
      where: { userId },
      order: { date: 'DESC' },
    });
  }

  async getBodyMeasurementStats(userId: string) {
    const measurements = await this.getBodyMeasurements(userId, 365);

    if (measurements.length === 0) {
      return {
        totalEntries: 0,
        weightDelta: 0,
        latestWeight: null,
        progress: {},
      };
    }

    const first = measurements[0];
    const last = measurements[measurements.length - 1];
    const weightDelta = last.weight && first.weight ? (last.weight - first.weight).toFixed(1) : '0.0';

    return {
      totalEntries: measurements.length,
      weightDelta,
      latestWeight: last.weight,
      progress: {
        weight: last.weight && first.weight ? last.weight - first.weight : 0,
        waist: last.waist && first.waist ? last.waist - first.waist : 0,
        chest: last.chest && first.chest ? last.chest - first.chest : 0,
        hips: last.hips && first.hips ? last.hips - first.hips : 0,
      },
    };
  }

  async updateBodyMeasurement(id: string, userId: string, dto: UpdateBodyMeasurementDto): Promise<BodyMeasurement> {
    const measurement = await this.bodyMeasurementRepo.findOne({ where: { id, userId } });
    if (!measurement) {
      throw new NotFoundException('Body measurement not found');
    }

    Object.assign(measurement, dto);
    return await this.bodyMeasurementRepo.save(measurement);
  }

  async deleteBodyMeasurement(id: string, userId: string): Promise<void> {
    const result = await this.bodyMeasurementRepo.delete({ id, userId });
    if (result.affected === 0) {
      throw new NotFoundException('Body measurement not found');
    }
  }

  // User Profile Methods
  async getUserProfileStats(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['coach', 'activeExercisePlan', 'activeMealPlan'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [measurementStats, photoCount] = await Promise.all([this.getBodyMeasurementStats(userId), this.progressPhotoRepo.count({ where: { userId } })]);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        membership: user.membership,
        role: user.role,
        status: user.status,
        gender: user.gender,
        coach: user.coach ? { id: user.coach.id, name: user.coach.name } : null,
        points: user.points,
        defaultRestSeconds: user.defaultRestSeconds,
        subscriptionStart: user.subscriptionStart,
        subscriptionEnd: user.subscriptionEnd,
        activeExercisePlan: user.activeExercisePlan,
        activeMealPlan: user.activeMealPlan,
        lastLogin: user.lastLogin,
      },
      stats: {
        measurementEntries: measurementStats.totalEntries,
        photoSets: photoCount,
        weightDelta: measurementStats.weightDelta,
        latestWeight: measurementStats.latestWeight,
      },
    };
  }
}
