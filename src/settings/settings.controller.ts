// src/modules/settings/settings.controller.ts
import { Controller, Get, Put, Query, Body, Post, UseInterceptors, UploadedFile, BadRequestException, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { Request } from 'express';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './settings.dto';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get()
  async get(@Req() req: any, @Query('user_id') user_id: any) {
    return this.service.get(user_id || req?.user?.id);
  }

  @Put()
  async update(@Req() req: any, @Body() dto: UpdateSettingsDto) {
    return this.service.update(req?.user?.id, dto);
  }

  /**
   * Accepts multipart/form-data field `file`
   * Stores to /uploads/og and returns public URL you can serve statically.
   */
  @Post('og-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const dest = join(process.cwd(), 'uploads', 'og');
          ensureDir(dest);
          cb(null, dest);
        },
        filename: (req, file, cb) => {
          const safe = file.originalname.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_.-]/g, '');
          const name = Date.now() + '-' + safe + extname(file.originalname);
          cb(null, name);
        },
      }),
      fileFilter: (req, file, cb) => {
        const ok = /^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.mimetype);
        cb(ok ? null : new BadRequestException('Invalid image type'), ok);
      },
      limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
    }),
  )
  async uploadOg(@Req() req: any, @UploadedFile() file?: any) {
    if (!file) throw new BadRequestException('No file uploaded');

    const publicUrl = `/static/og/${file.filename}`;
    const updated = await this.service.setOgImageUrl(req?.user?.id, publicUrl);

    return { url: publicUrl, settings: updated };
  }
}
