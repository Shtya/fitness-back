import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from 'entities/global.entity';
import { PlatformAppearanceService } from './platform-appearance.service';
import { UpdateDashboardBackgroundDto } from './dto/tenant.dto';

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function backgroundUploadDir() {
  const dir = join(process.cwd(), 'uploads', 'branding');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

@Controller('appearance')
@UseGuards(JwtAuthGuard)
export class PlatformAppearanceController {
  constructor(private readonly appearance: PlatformAppearanceService) {}

  @Get('dashboard-background')
  getDashboardBackground() {
    return this.appearance.getDashboardBackground();
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Put('dashboard-background')
  setDashboardBackground(@Req() req: any, @Body() dto: UpdateDashboardBackgroundDto) {
    return this.appearance.setDashboardBackground(req.user?.id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Post('dashboard-background/image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, backgroundUploadDir()),
        filename: (_req, file, cb) => {
          const unique = `dash-bg-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${unique}${IMAGE_EXTENSIONS[file.mimetype.toLowerCase()] || '.jpg'}`);
        },
      }),
      limits: { fileSize: 6 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = Boolean(IMAGE_EXTENSIONS[String(file.mimetype || '').toLowerCase()]);
        cb(ok ? null : new BadRequestException('Only image uploads allowed'), ok);
      },
    }),
  )
  uploadDashboardBackground(@Req() req: any, @UploadedFile() file: { filename: string } | undefined) {
    if (!file) throw new BadRequestException('Image file is required');
    return this.appearance.setDashboardBackground(req.user?.id, {
      kind: 'image',
      value: `/uploads/branding/${file.filename}`,
    });
  }
}
