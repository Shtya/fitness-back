import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { User } from 'entities/global.entity';
import {
  Tenant,
  TenantBranding,
  TenantBrandingAudit,
  TenantLicenseAttempt,
} from 'entities/tenant.entity';
import { TenantService } from './tenant.service';
import { TenantController } from './tenant.controller';
import { PlatformAppearanceController } from './platform-appearance.controller';
import { PlatformAppearanceService } from './platform-appearance.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tenant,
      TenantBranding,
      TenantBrandingAudit,
      TenantLicenseAttempt,
      User,
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [TenantController, PlatformAppearanceController],
  providers: [TenantService, PlatformAppearanceService],
  exports: [TenantService],
})
export class TenantModule {}
