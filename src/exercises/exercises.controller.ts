// src/plan-exercises/plan-exercises.controller.ts
import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { BulkCreatePlanExerciseDto, CreatePlanExerciseDto, SetStatusDto, UpdatePlanExerciseDto } from 'dto/exercises.dto';

import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from 'entities/global.entity';
import { imageUploadOptions, videoUploadOptions } from './upload.config';
import { PlanExercisesService } from './exercises.service';
import { mixedUploadOptions } from './mixed-upload.config';

function parseMaybeJsonArray(v: any) {
  if (v == null || v === '') return undefined;
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed;
      // allow comma list fallback
      return v
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    } catch {
      return v
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    }
  }
  return undefined;
}
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

  /* List with CRUD.findAll */
  @Get()
  async list(@Query() q: any) {
    return this.svc.list(q);
  }
  @Get('stats')
  async stats() {
    return this.svc.stats();
  }

  /* Get one */
  @Get(':id')
  async get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  /* Create */
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
    const dto: CreatePlanExerciseDto = {
      name: body.name,
      targetReps: body.targetReps,
      desc: body.desc ?? null,
      equipment: body.equipment ?? null,
      orderIndex: toIntOrUndef(body.orderIndex) ?? 0,
      targetSets: toIntOrUndef(body.targetSets) ?? 3,
      restSeconds: toIntOrUndef(body.restSeconds) ?? 90,
      primaryMuscles: parseMaybeJsonArray(body.primaryMuscles) ?? [],
      secondaryMuscles: parseMaybeJsonArray(body.secondaryMuscles) ?? [],
      alternatives: parseMaybeJsonArray(body.alternatives) ?? [],
      status: body.status ?? 'Active',
      dayId: body.dayId ?? undefined,
      img: files?.img?.[0] ? `/uploads/images/${files.img[0].filename}` : (body.img ?? null),
      video: files?.video?.[0] ? `/uploads/videos/${files.video[0].filename}` : (body.video ?? null),
    };
    return this.svc.create(dto);
  }

  @Post('bulk')
  bulkCreate(@Body() dto: BulkCreatePlanExerciseDto) {
    return this.svc.bulkCreate(dto.items);
  }

  // UPDATE: multipart (optional new img/video) OR pure JSON
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
    const patch: UpdatePlanExerciseDto = {
      // text fields (optional)
      name: body.name ?? undefined,
      targetReps: body.targetReps ?? undefined,
      desc: body.desc ?? undefined,
      equipment: body.equipment ?? undefined,
      status: body.status ?? undefined,
      dayId: body.dayId ?? undefined,

      // numbers (optional)
      orderIndex: body.orderIndex !== undefined ? toIntOrUndef(body.orderIndex) : undefined,
      targetSets: body.targetSets !== undefined ? toIntOrUndef(body.targetSets) : undefined,
      restSeconds: body.restSeconds !== undefined ? toIntOrUndef(body.restSeconds) : undefined,

      // arrays (optional)
      primaryMuscles: parseMaybeJsonArray(body.primaryMuscles),
      secondaryMuscles: parseMaybeJsonArray(body.secondaryMuscles),
      alternatives: parseMaybeJsonArray(body.alternatives),

      // media: only override if new files sent; otherwise leave as-is
      img: files?.img?.[0] ? `/uploads/images/${files.img[0].filename}` : (body.img ?? undefined),
      video: files?.video?.[0] ? `/uploads/videos/${files.video[0].filename}` : (body.video ?? undefined),
    };

    return this.svc.update(id, patch);
  }

  /* Delete */
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  /* Set status only */
  @Put(':id/status')
  async setStatus(@Param('id') id: string, @Body() dto: SetStatusDto) {
    return this.svc.update(id, { status: dto.status });
  }

  /* Upload image and save path */
  @Post(':id/upload-image')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async uploadImage(@Param('id') id: string, @UploadedFile() file: any) {
    // Store relative path you’ll serve statically (e.g., /uploads/images/xxx.png)
    const relPath = `/uploads/images/${file.filename}`;
    return this.svc.updateImage(id, relPath);
  }

  /* Upload video and save path */
  @Post(':id/upload-video')
  @UseInterceptors(FileInterceptor('file', videoUploadOptions))
  async uploadVideo(@Param('id') id: string, @UploadedFile() file: any) {
    const relPath = `/uploads/videos/${file.filename}`;
    return this.svc.updateVideo(id, relPath);
  }
}
