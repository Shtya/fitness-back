import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Req as NestReq,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from 'entities/global.entity';
import { TenantStatus } from 'entities/tenant.entity';
import { TenantService } from './tenant.service';
import {
  CreateTenantDto,
  DiscoverTenantByEmailDto,
  DiscoverTenantByLicenseDto,
  UpdateTenantBrandingDto,
} from './dto/tenant.dto';

function brandingUploadDir() {
  const dir = join(process.cwd(), 'uploads', 'branding');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Avoid Express.Multer.File — breaks with @types/express v5 when Multer types aren't merged. */
type BrandingUploadFile = {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
};

@Controller()
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  // ── Public discovery ──────────────────────────────────────────────
  @Post('auth/discover-tenant')
  discoverByEmail(@Body() dto: DiscoverTenantByEmailDto) {
    return this.tenants.discoverByEmail(dto.email);
  }

  @Post('auth/discover-tenant-by-license')
  discoverByLicense(@Body() dto: DiscoverTenantByLicenseDto, @Req() req: any) {
    const ip = req.headers['x-forwarded-for'] || req.ip;
    return this.tenants.discoverByLicense(dto.licenseKey, Array.isArray(ip) ? ip[0] : ip);
  }

  @Get('public/tenants/:slug/branding')
  publicBranding(@Param('slug') slug: string) {
    return this.tenants.getPublicBrandingBySlug(slug);
  }

  @Get('tenant/branding/defaults')
  defaults() {
    return this.tenants.getDefaults();
  }

  // ── Authenticated branding ────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('tenant/branding')
  getBranding(@Req() req: any) {
    return this.tenants.getBrandingForUser(req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('tenant/branding')
  updateBranding(@Req() req: any, @Body() dto: UpdateTenantBrandingDto) {
    return this.tenants.updateBranding(req.user, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post('tenant/branding/reset')
  resetBranding(@Req() req: any) {
    return this.tenants.resetBranding(req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post('tenant/branding/assets')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, brandingUploadDir()),
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${unique}${extname(file.originalname).toLowerCase()}`);
        },
      }),
      limits: { fileSize: 3 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.mimetype);
        cb(ok ? null : new Error('Only image uploads allowed'), ok);
      },
    }),
  )
  async uploadAsset(
    @Req() req: any,
    @UploadedFile() file: BrandingUploadFile,
    @Body('assetType') assetType: string,
  ) {
    if (!file) throw new Error('File required');
    const url = `/uploads/branding/${file.filename}`;
    return this.tenants.setAssetUrl(req.user, assetType, url);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Delete('tenant/branding/assets/:assetType')
  clearAsset(@Req() req: any, @Param('assetType') assetType: string) {
    return this.tenants.clearAsset(req.user, assetType);
  }

  // ── Admin org license (share with new users for discovery) ─────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('tenant/license')
  getLicense(@Req() req: any) {
    return this.tenants.getLicenseForAdmin(req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post('tenant/license/rotate')
  rotateOwnLicense(@Req() req: any) {
    return this.tenants.rotateLicenseForAdmin(req.user);
  }

  // ── Super admin tenant management ─────────────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Get('super-admin/tenants')
  listTenants(@Req() req: any) {
    return this.tenants.listTenants(req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Post('super-admin/tenants')
  createTenant(@Req() req: any, @Body() dto: CreateTenantDto) {
    return this.tenants.createTenant(req.user, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Put('super-admin/tenants/:id/status')
  setStatus(@Req() req: any, @Param('id') id: string, @Body('status') status: TenantStatus) {
    return this.tenants.setTenantStatus(req.user, id, status);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Post('super-admin/tenants/:id/rotate-license')
  rotateLicense(@Req() req: any, @Param('id') id: string) {
    return this.tenants.rotateLicense(req.user, id);
  }
}
