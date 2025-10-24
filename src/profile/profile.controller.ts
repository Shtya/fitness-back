import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, ParseUUIDPipe, BadRequestException, UseInterceptors, UploadedFiles } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { CreateProgressPhotoDto, CreateBodyMeasurementDto, UpdateBodyMeasurementDto, TimelineQueryDto } from 'dto/profile.dto';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { CRUD } from 'common/crud.service';
import { FileFieldsInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { mixedUploadOptions, profilePhotoUploadOptions } from 'src/exercises/mixed-upload.config';

@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  // User Profile Endpoints
  @Get('stats')
  async getProfileStats(@Request() req) {
    return this.profileService.getUserProfileStats(req.user.id);
  }

  @Post('photos')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'front', maxCount: 1 },
        { name: 'back', maxCount: 1 },
        { name: 'left', maxCount: 1 },
        { name: 'right', maxCount: 1 },
      ],
      profilePhotoUploadOptions,
    ),
  )
  async createProgressPhoto(
    @Request() req,
    @UploadedFiles()
    files: {
      front?: any[];
      back?: any[];
      left?: any[];
      right?: any[];
    },
    @Body() body: any,  
  ) {
		const data = JSON.parse(body.data)
     const photoData = {
      takenAt: data?.takenAt,
      weight: data?.weight ? parseFloat(data.weight) : null,
      note: data?.note || '',
    };

 
    // Validate required fields
    if (!photoData.takenAt) {
      throw new BadRequestException('takenAt field is required');
    }

    const sides = {};

    if (files.front?.[0]) sides['front'] = `/uploads/images/progress-photos/${files.front[0].filename}`;
    if (files.back?.[0]) sides['back'] = `/uploads/images/progress-photos/${files.back[0].filename}`;
    if (files.left?.[0]) sides['left'] = `/uploads/images/progress-photos/${files.left[0].filename}`;
    if (files.right?.[0]) sides['right'] = `/uploads/images/progress-photos/${files.right[0].filename}`;

    const createPhotoDto: CreateProgressPhotoDto = {
      takenAt: photoData.takenAt,
      weight: photoData.weight,
      note: photoData.note,
      sides: sides as any,
    };

    return this.profileService.createProgressPhoto(req.user.id, createPhotoDto);
  }

  @Get('photos/timeline')
  async listProgressPhotos(@Request() req, @Query() query: any) {
    const { search, page, limit, sortBy, sortOrder, filters } = query;

    function parseJSON<T = any>(input?: string): T | undefined {
      if (!input) return undefined;
      try {
        return JSON.parse(input);
      } catch {
        throw new BadRequestException('Invalid JSON in "filters" query param.');
      }
    }

    const filtersObj = parseJSON<Record<string, any>>(filters) ?? {};
    const filtersWithUser = { ...filtersObj, userId: req.user.id };

    return CRUD.findAll(this.profileService.progressPhotoRepo, 'p', search, page, limit, sortBy, sortOrder ?? 'DESC', [], [], filtersWithUser);
  }

  @Get('photos/:id')
  async getProgressPhoto(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    return this.profileService.getProgressPhoto(id, req.user.id);
  }

  @Delete('photos/:id')
  async deleteProgressPhoto(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    return this.profileService.deleteProgressPhoto(id, req.user.id);
  }

  // Body Measurements Endpoints
  @Post('measurements')
  async createBodyMeasurement(@Request() req, @Body() dto: CreateBodyMeasurementDto) {
    return this.profileService.createBodyMeasurement(req.user.id, dto);
  }

  @Get('measurements')
  async getBodyMeasurements(@Request() req, @Query('days') days: number) {
    return this.profileService.getBodyMeasurements(req.user.id, days);
  }

  @Get('measurements/latest')
  async getLatestBodyMeasurement(@Request() req) {
    return this.profileService.getLatestBodyMeasurement(req.user.id);
  }

  @Get('measurements/stats')
  async getBodyMeasurementStats(@Request() req) {
    return this.profileService.getBodyMeasurementStats(req.user.id);
  }

  @Put('measurements/:id')
  async updateBodyMeasurement(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBodyMeasurementDto) {
    return this.profileService.updateBodyMeasurement(id, req.user.id, dto);
  }

  @Delete('measurements/:id')
  async deleteBodyMeasurement(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    return this.profileService.deleteBodyMeasurement(id, req.user.id);
  }
}
