// src/modules/settings/settings.controller.ts
import { Controller, Get, Put, Body, Post, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './settings.dto';

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

@Controller('settings')
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get()
  async get() {
    return this.service.get();
  }

  @Put()
  async update(@Body() dto: UpdateSettingsDto) {
    return this.service.update(dto);
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
          const name = Date.now() + '-' + safe;
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
  async uploadOg(@UploadedFile() file?: any) {
    if (!file) throw new BadRequestException('No file uploaded');
    // adjust to your static host; here we assume /uploads is served at /static
    const publicUrl = `/static/og/${file.filename}`;
    const updated = await this.service.setOgImageUrl(publicUrl);
    return { url: publicUrl, settings: updated };
  }
}
