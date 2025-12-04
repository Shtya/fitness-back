// src/asset/asset.controller.ts
import { Controller, Post, UploadedFile, UploadedFiles, UseInterceptors, Req, Body, Delete, Param, Get, Patch, NotFoundException, Query, BadRequestException } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { multerOptions } from 'common/multer.config';
import { CreateAssetDto, UpdateAssetDto } from 'dto/assets.dto';
import { AssetService } from './asset.service';

@Controller('assets')
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  // helper to extract client IP (handles proxy header if present)
  private getClientIp(req: any): string | null {
    const xForwardedFor = (req.headers['x-forwarded-for'] as string) || '';
    if (xForwardedFor) {
      return xForwardedFor.split(',')[0].trim();
    }
    return req.ip || req.connection?.remoteAddress || null;
  }

  // ✅ Single asset upload: uses userId query or IP
  @Post()
  @UseInterceptors(FileInterceptor('file', multerOptions))
  async upload(@UploadedFile() file: any, @Body() dto: CreateAssetDto, @Req() req: any, @Query('userId') userId?: string) {
    const ipAddress = this.getClientIp(req);

    let user = null;
    if (userId) {
      user = await this.assetService.findUserById(userId);
      if (!user) {
        throw new NotFoundException('User not found with provided userId');
      }
    }

    if (!user && !ipAddress) {
      throw new BadRequestException('Missing userId or IP address. Cannot create asset.');
    }

    return this.assetService.Create(dto, file, user, ipAddress);
  }

  // ✅ Multiple assets upload: uses userId query or IP
  @Post('bulk')
  @UseInterceptors(FilesInterceptor('files', 20, multerOptions))
  async uploadMultiple(@UploadedFiles() files: any[], @Body() dto: CreateAssetDto, @Req() req: any, @Query('userId') userId?: string) {
    if (!files?.length) throw new NotFoundException('No files uploaded');

    const ipAddress = this.getClientIp(req);

    let user = null;
    if (userId) {
      user = await this.assetService.findUserById(userId);
      if (!user) {
        throw new NotFoundException('User not found with provided userId');
      }
    }

    if (!user && !ipAddress) {
      throw new BadRequestException('Missing userId or IP address. Cannot create assets.');
    }

    const assets = await Promise.all(files.map(file => this.assetService.Create(dto, file, user, ipAddress)));

    return {
      message: 'Assets uploaded successfully',
      assets,
    };
  }

  // ✅ List assets: by userId if provided, otherwise by IP
  @Get()
  async getUserAssets(@Req() req: any, @Query('userId') userId?: string) {
    if (userId) {
      const user = await this.assetService.findUserById(userId);
      if (!user) {
        throw new NotFoundException('User not found with provided userId');
      }
      return this.assetService.findAllByUser(user.id);
    }

    const ipAddress = this.getClientIp(req);
    if (!ipAddress) {
      throw new BadRequestException('Missing userId or IP address. Cannot list assets.');
    }

    return this.assetService.findAllByIp(ipAddress);
  }

  @Get(':id')
  async getAsset(@Param('id') id: string) {
    return this.assetService.findOne(id);
  }

  // Update & delete are left open; you can guard them if you want.
  @Patch(':id')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  async updateAsset(@Param('id') id: string, @UploadedFile() file: any, @Body() dto: UpdateAssetDto) {
    return this.assetService.update(id, dto, file);
  }

  @Delete(':id')
  async deleteAsset(@Param('id') id: string) {
    return this.assetService.delete(id);
  }
}
