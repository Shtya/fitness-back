// src/plan-exercises/plan-exercises.controller.ts
import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { BulkCreatePlanExercisesDto } from 'dto/exercises.dto';

import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PlanExercises, UserRole } from 'entities/global.entity';
import { imageUploadOptions, videoUploadOptions } from './upload.config';
import { PlanExercisesService } from './exercises.service';
import { mixedUploadOptions } from './mixed-upload.config';
import { CRUD } from 'common/crud.service';

function toIntOrUndef(v: any) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (Number.isNaN(n)) throw new BadRequestException(`Expected number, got "${v}"`);
  return n;
}

@Controller('plan-exercises')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PlanExercisesController {
  constructor(private readonly svc: PlanExercisesService) {}

  @Get()
  async list(@Query() q: any) {
    return this.svc.list(q);
  }

  @Post('upload-exercise-video')
  @UseInterceptors(FileInterceptor('video', videoUploadOptions))
  async uploadExerciseVideo(
    @Body()
    body: {
      exerciseId: string;
      userId: string;
      exerciseName: string;
      workoutDate?: string;
      setNumber?: number;
      weight?: number;
      reps?: number;
      notes?: string;
    },
    @UploadedFile() video: any,
  ) {
    if (!video) {
      throw new BadRequestException('Video file is required');
    }

    const videoUrl = `/uploads/videos/${video.filename}`;

    // Save to database
    const savedVideo = await this.svc.saveExerciseVideo({
      userId: body.userId,
      exerciseName: body.exerciseName,
      videoUrl: videoUrl,
      workoutDate: body.workoutDate,
      setNumber: body.setNumber,
      weight: body.weight,
      reps: body.reps,
      notes: body.notes,
    });

    return {
      success: true,
      videoUrl: videoUrl,
      message: 'Video uploaded successfully for coach review',
      videoId: savedVideo.id,
      exerciseName: body.exerciseName,
    };
  }

  // Get videos for a specific user
  @Get('user-videos/:userId')
  async getUserVideos(@Param('userId') userId: string) {
    return await this.svc.getUserExerciseVideos(userId);
  }

  // Get videos for coach review
  @Get('coach-videos/:coachId')
  async getCoachVideos(@Param('coachId') coachId: string, @Query('status') status?: string) {
    return await this.svc.getVideosForCoach(coachId, status);
  }

  // Update video feedback (coach reviewing video)
  @Put('video-feedback/:videoId')
  async updateVideoFeedback(@Param('videoId') videoId: string, @Body() body: { coachId: string; status: string; coachFeedback: string }) {
    return await this.svc.updateVideoFeedback(videoId, body.coachId, body);
  }

  @Get('stats')
  async stats(@Query() q: any) {
    return this.svc.stats(q);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'img', maxCount: 1 },
        { name: 'video', maxCount: 1 },
      ],
      mixedUploadOptions,
    ),
  )
  async create(@Body() body: any, @UploadedFiles() files: { img?: any[]; video?: any[] }) {
    const dto: any = {
      name: body.name,
      targetReps: body.targetReps,
      targetSets: toIntOrUndef(body.targetSets) ?? 3,
      rest: toIntOrUndef(body.rest) ?? 90,
      tempo: body.tempo ?? null,
      img: files?.img?.[0] ? `/uploads/images/${files.img[0].filename}` : (body.img ?? null),
      video: files?.video?.[0] ? `/uploads/videos/${files.video[0].filename}` : (body.video ?? null),
    };
    return this.svc.create(dto);
  }

  @Post('bulk')
  async bulkCreate(@Body() dto: any) {
    const sanitized = (dto.items || []).map((i: any) => ({
      name: i.name,
      targetReps: String(i.targetReps ?? '10'),
      targetSets: Number(i.targetSets ?? 3),
      rest: Number(i.rest ?? 90),
      tempo: i.tempo ?? null,
      img: i.img ?? null,
      video: i.video ?? null,
    }));
    return this.svc.bulkCreate(sanitized);
  }

  @Put(':id')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'img', maxCount: 1 },
        { name: 'video', maxCount: 1 },
      ],
      mixedUploadOptions,
    ),
  )
  async update(@Param('id') id: string, @Body() body: any, @UploadedFiles() files: { img?: any[]; video?: any[] }) {
    const patch: any = {
      name: body.name ?? undefined,
      targetReps: body.targetReps ?? undefined,
      targetSets: body.targetSets !== undefined ? toIntOrUndef(body.targetSets) : undefined,
      rest: body.rest !== undefined ? toIntOrUndef(body.rest) : undefined,
      tempo: body.tempo ?? undefined,

      img: files?.img?.[0] ? `/uploads/images/${files.img[0].filename}` : (body.img ?? undefined),
      video: files?.video?.[0] ? `/uploads/videos/${files.video[0].filename}` : (body.video ?? undefined),
    };
    return this.svc.update(id, patch);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Post(':id/upload-image')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async uploadImage(@Param('id') id: string, @UploadedFile() file: any) {
    return this.svc.updateImage(id, `/uploads/images/${file.filename}`);
  }

  @Post(':id/upload-video')
  @UseInterceptors(FileInterceptor('file', videoUploadOptions))
  async uploadVideo(@Param('id') id: string, @UploadedFile() file: any) {
    return this.svc.updateVideo(id, `/uploads/videos/${file.filename}`);
  }
}
