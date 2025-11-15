// src/exercises/exercises.controller.ts
import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UploadedFile, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';

import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from 'entities/global.entity';
import { imageUploadOptions, videoUploadOptions } from './upload.config';
import { ExercisesService } from './exercises.service';
import { mixedUploadOptions, mixedUploadOptionsWorkouts } from './mixed-upload.config';

function toIntOrUndef(v: any) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (Number.isNaN(n)) throw new BadRequestException(`Expected number, got "${v}"`);
  return n;
}

function toStringOrUndef(v: any) {
  if (v === undefined || v === null || v === '') return undefined;
  return String(v);
}

function parseStringArray(input: unknown): string[] | undefined {
  if (input === undefined || input === null || input === '') return undefined;
  if (Array.isArray(input))
    return input
      .map(String)
      .map(s => s.trim())
      .filter(Boolean);
  const s = String(input).trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed))
      return parsed
        .map(String)
        .map(x => x.trim())
        .filter(Boolean);
  } catch (_) {
    /* CSV fallback */
  }
  return s
    .split(/[;,]/g)
    .map(x => x.trim())
    .filter(Boolean);
}

@Controller('plan-exercises')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PlanExercisesController {
  constructor(private readonly svc: ExercisesService) {}

  @Get()
  async list(@Query() q: any, @Req() req: any) {
    return this.svc.list(q, q?.user_id ?? req?.user?.id);
  }

  @Get('categories')
  async categories() {
    return this.svc.categories();
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
    if (!video) throw new BadRequestException('Video file is required');

    const videoUrl = `/uploads/videos/${video.filename}`;
    const savedVideo = await this.svc.saveExerciseVideo({
      userId: body.userId,
      exerciseName: body.exerciseName,
      videoUrl,
      workoutDate: body.workoutDate,
      setNumber: body.setNumber,
      weight: body.weight,
      reps: body.reps,
      notes: body.notes,
    });

    return {
      success: true,
      videoUrl,
      message: 'Video uploaded successfully for coach review',
      videoId: savedVideo.id,
      exerciseName: body.exerciseName,
    };
  }

  @Get('user-videos/:userId')
  async getUserVideos(@Param('userId') userId: string) {
    return await this.svc.getUserExerciseVideos(userId);
  }

  @Get('coach-videos/:coachId')
  async getCoachVideos(@Param('coachId') coachId: string, @Query('status') status?: string) {
    return await this.svc.getVideosForCoach(coachId, status);
  }

  @Put('video-feedback/:videoId')
  async updateVideoFeedback(@Param('videoId') videoId: string, @Body() body: { coachId: string; status: string; coachFeedback: string }) {
    return await this.svc.updateVideoFeedback(videoId, body.coachId, body);
  }

  @Get('stats')
  async stats(@Req() req: any, @Query() q: any) {
    return this.svc.stats(q, {
      id: req.user.id,
      role: req.user.role,
    });
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post('bulk')
  async bulkCreate(@Body() dto: any) {
    const sanitized = (dto.items || []).map((i: any) => ({
      name: i.name,
      details: i.details ?? null,
      category: i.category ?? null,
      primaryMusclesWorked: parseStringArray(i.primary_muscles_worked) ?? [],
      secondaryMusclesWorked: parseStringArray(i.secondary_muscles_worked) ?? [],
      targetReps: String(i.targetReps ?? '10'),
      targetSets: Number(i.targetSets ?? 3),
      rest: Number(i.rest ?? 90),
      tempo: i.tempo ?? null,
      img: i.img ?? null,
      video: i.video ?? null,
    }));
    return this.svc.bulkCreate(sanitized);
  }

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'img', maxCount: 1 },
        { name: 'video', maxCount: 1 },
      ],
      mixedUploadOptionsWorkouts,
    ),
  )
  async create(@Body() body: any, @UploadedFiles() files: { img?: any[]; video?: any[] }) {
    const dto: any = {
      userId: body.userId,
      name: body.name,
      details: toStringOrUndef(body.details) ?? null,
      category: toStringOrUndef(body.category) ?? null,
      primaryMusclesWorked: parseStringArray(body.primaryMusclesWorked) ?? [],
      secondaryMusclesWorked: parseStringArray(body.secondaryMusclesWorked) ?? [],
      targetReps: body.targetReps,
      targetSets: toIntOrUndef(body.targetSets) ?? 3,
      rest: toIntOrUndef(body.rest) ?? 90,
      tempo: body.tempo ?? null,
      img: files?.img?.[0] ? `/uploads/images/${files.img[0].filename}` : (body.img ?? null),
      video: files?.video?.[0] ? `/uploads/videos/${files.video[0].filename}` : (body.video ?? null),
    };
    return this.svc.create(dto);
  }

  @Put(':id')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'img', maxCount: 1 },
        { name: 'video', maxCount: 1 },
      ],
      mixedUploadOptionsWorkouts,
    ),
  )
  async update(@Param('id') id: string, @Body() body: any, @UploadedFiles() files: { img?: any[]; video?: any[] }) {
    const patch: any = {
      name: body.name ?? undefined,
      details: body.details ?? undefined,
      category: body.category ?? undefined,
      primaryMusclesWorked: body.primaryMusclesWorked !== undefined ? parseStringArray(body.primaryMusclesWorked) : undefined,
      secondaryMusclesWorked: body.secondaryMusclesWorked !== undefined ? parseStringArray(body.secondaryMusclesWorked) : undefined,
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
  async remove(@Param('id') id: string, @Req() req: any, @Query('lang') lang?: string) {
    const language = lang || req.headers['accept-language']?.split(',')[0]?.startsWith('ar') ? 'ar' : 'en';
    return this.svc.remove(id, { id: req.user.id, role: req.user.role, lang: language });
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
