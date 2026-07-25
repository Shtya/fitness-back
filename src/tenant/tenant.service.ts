import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from 'entities/global.entity';
import {
  Tenant,
  TenantBranding,
  TenantBrandingAudit,
  TenantLicenseAttempt,
  TenantStatus,
} from 'entities/tenant.entity';
import {
  DEFAULT_BRANDING,
  generateLicenseKey,
  hashLicenseKey,
  mergeBranding,
  publicBrandingPayload,
  slugifyTenant,
} from './tenant.defaults';
import { CreateTenantDto, UpdateTenantBrandingDto } from './dto/tenant.dto';

const DISCOVERY_TTL = '15m';
const ASSET_TYPES = [
  'logoLight',
  'logoDark',
  'icon',
  'splashLogo',
  'loginBackground',
  'placeholderImage',
] as const;

export type BrandingAssetType = (typeof ASSET_TYPES)[number];

const ASSET_FIELD: Record<BrandingAssetType, keyof TenantBranding> = {
  logoLight: 'logoLightUrl',
  logoDark: 'logoDarkUrl',
  icon: 'iconUrl',
  splashLogo: 'splashLogoUrl',
  loginBackground: 'loginBackgroundUrl',
  placeholderImage: 'placeholderImageUrl',
};

@Injectable()
export class TenantService implements OnModuleInit {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(TenantBranding) private readonly brandingRepo: Repository<TenantBranding>,
    @InjectRepository(TenantBrandingAudit) private readonly auditRepo: Repository<TenantBrandingAudit>,
    @InjectRepository(TenantLicenseAttempt) private readonly attemptRepo: Repository<TenantLicenseAttempt>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
  ) {}

  async onModuleInit() {
    try {
      await this.ensureDefaultTenant();
      await this.backfillUsersIfNeeded();
    } catch (e) {
      this.logger.warn(`Tenant bootstrap skipped: ${(e as Error)?.message || e}`);
    }
  }

  async ensureDefaultTenant() {
    let tenant = await this.tenantRepo.findOne({ where: { slug: 'so7bafit' } });
    if (!tenant) {
      tenant = await this.tenantRepo.save(
        this.tenantRepo.create({
          name: 'So7baFit Default',
          slug: 'so7bafit',
          status: TenantStatus.ACTIVE,
          ownerUserId: null,
        }),
      );
    }
    const branding = await this.brandingRepo.findOne({ where: { tenantId: tenant.id } });
    if (!branding) {
      await this.brandingRepo.save(
        this.brandingRepo.create({
          tenantId: tenant.id,
          ...DEFAULT_BRANDING,
        } as any),
      );
    }
    return tenant;
  }

  async backfillUsersIfNeeded() {
    const admins = await this.userRepo.find({ where: { role: UserRole.ADMIN } as any });
    for (const admin of admins) {
      let tenant = await this.tenantRepo.findOne({ where: { ownerUserId: admin.id } });
      if (!tenant) {
        const base = slugifyTenant(admin.email?.split('@')[0] || admin.name || 'org');
        let slug = `${base}-${admin.id.replace(/-/g, '').slice(0, 8)}`;
        let n = 0;
        while (await this.tenantRepo.findOne({ where: { slug } })) {
          n += 1;
          slug = `${base}-${n}`;
        }
        tenant = await this.tenantRepo.save(
          this.tenantRepo.create({
            name: admin.name || 'Organization',
            slug,
            status: TenantStatus.ACTIVE,
            ownerUserId: admin.id,
            ...(() => {
              const license = generateLicenseKey();
              return {
                licenseKeyHash: license.hash,
                licenseKeyPrefix: license.prefix,
                licenseInviteKey: license.raw,
                licenseActive: true,
              };
            })(),
          }),
        );
        await this.brandingRepo.save(
          this.brandingRepo.create({
            tenantId: tenant.id,
            ...DEFAULT_BRANDING,
            appName: admin.name || DEFAULT_BRANDING.appName,
            companyName: admin.name || DEFAULT_BRANDING.companyName,
          } as any),
        );
      }
      if (!admin.tenantId) {
        admin.tenantId = tenant.id;
        await this.userRepo.save(admin);
      }
    }

    const orphans = await this.userRepo
      .createQueryBuilder('u')
      .where('u.tenantId IS NULL')
      .getMany();
    if (!orphans.length) return;

    const defaultTenant = await this.ensureDefaultTenant();
    for (const user of orphans) {
      if (user.adminId) {
        const ownerTenant = await this.tenantRepo.findOne({ where: { ownerUserId: user.adminId } });
        user.tenantId = ownerTenant?.id || defaultTenant.id;
      } else {
        user.tenantId = defaultTenant.id;
      }
      await this.userRepo.save(user);
    }
  }

  resolveTenantIdFromUser(user: User): string | null {
    return user?.tenantId || null;
  }

  async assertUserInTenant(user: User, tenantId: string) {
    if (user.role === UserRole.SUPER_ADMIN) return;
    if (!user.tenantId || user.tenantId !== tenantId) {
      throw new ForbiddenException('Cross-tenant access denied');
    }
  }

  canManageBranding(user: User): boolean {
    return user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN;
  }

  private applyLicense(tenant: Tenant, license = generateLicenseKey()) {
    tenant.licenseKeyHash = license.hash;
    tenant.licenseKeyPrefix = license.prefix;
    tenant.licenseInviteKey = license.raw;
    tenant.licenseActive = true;
    return license;
  }

  private async resolveAdminTenant(user: User): Promise<Tenant> {
    if (!this.canManageBranding(user)) throw new ForbiddenException('Insufficient permissions');
    const tenantId = this.resolveTenantIdFromUser(user);
    if (!tenantId) throw new BadRequestException('No organization linked to this account');
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Organization not found');
    if (user.role !== UserRole.SUPER_ADMIN) {
      await this.assertUserInTenant(user, tenant.id);
    }
    return tenant;
  }

  /** Admin: view org license to share with new users (mobile/web discovery). */
  async getLicenseForAdmin(user: User) {
    const tenant = await this.resolveAdminTenant(user);
    let issued = false;
    // Legacy tenants only had a hash — issue a fresh shareable key once.
    if (!tenant.licenseInviteKey) {
      this.applyLicense(tenant);
      await this.tenantRepo.save(tenant);
      issued = true;
    }
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      licenseKey: tenant.licenseInviteKey,
      licenseKeyPrefix: tenant.licenseKeyPrefix,
      licenseActive: tenant.licenseActive,
      licenseExpiresAt: tenant.licenseExpiresAt,
      issued,
    };
  }

  /** Admin: regenerate org license (invalidates the previous code). */
  async rotateLicenseForAdmin(user: User) {
    const tenant = await this.resolveAdminTenant(user);
    const license = this.applyLicense(tenant);
    await this.tenantRepo.save(tenant);
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      licenseKey: license.raw,
      licenseKeyPrefix: license.prefix,
      licenseActive: true,
      rotated: true,
    };
  }

  async discoverByEmail(email: string) {
    const normalized = String(email || '').trim().toLowerCase();
    // Anti-enumeration: always return a soft shape; only include real tenant when found.
    const user = await this.userRepo.findOne({ where: { email: normalized } as any });
    if (!user?.tenantId) {
      return {
        ok: true,
        found: false,
        message: 'If an account exists, organization details will appear after verification.',
      };
    }

    const tenant = await this.tenantRepo.findOne({ where: { id: user.tenantId } });
    if (!tenant || tenant.status === TenantStatus.SUSPENDED) {
      return {
        ok: true,
        found: false,
        message: 'If an account exists, organization details will appear after verification.',
      };
    }

    const brandingRow = await this.brandingRepo.findOne({ where: { tenantId: tenant.id } });
    const branding = mergeBranding(brandingRow);
    const discoveryToken = this.jwt.sign(
      { typ: 'tenant_discovery', tenantId: tenant.id, email: normalized },
      {
        secret: this.cfg.get<string>('JWT_SECRET')!,
        expiresIn: DISCOVERY_TTL,
      },
    );

    return {
      ok: true,
      found: true,
      discoveryToken,
      ...publicBrandingPayload(branding, tenant),
    };
  }

  async discoverByLicense(licenseKey: string, ip?: string) {
    const prefix = String(licenseKey || '').trim().slice(0, 8).toUpperCase();
    const hash = hashLicenseKey(licenseKey);
    const tenant = await this.tenantRepo.findOne({ where: { licenseKeyHash: hash } });

    if (!tenant || !tenant.licenseActive || tenant.status === TenantStatus.SUSPENDED) {
      await this.attemptRepo.save(
        this.attemptRepo.create({
          ip: ip || null,
          licensePrefix: prefix,
          success: false,
          reason: 'invalid_or_inactive',
        }),
      );
      throw new UnauthorizedException('Invalid organization code');
    }

    if (tenant.licenseExpiresAt && tenant.licenseExpiresAt.getTime() < Date.now()) {
      await this.attemptRepo.save(
        this.attemptRepo.create({
          ip: ip || null,
          licensePrefix: prefix,
          success: false,
          reason: 'expired',
        }),
      );
      throw new UnauthorizedException('Organization code expired');
    }

    await this.attemptRepo.save(
      this.attemptRepo.create({
        ip: ip || null,
        licensePrefix: prefix,
        success: true,
        reason: null,
      }),
    );

    const brandingRow = await this.brandingRepo.findOne({ where: { tenantId: tenant.id } });
    const branding = mergeBranding(brandingRow);
    const discoveryToken = this.jwt.sign(
      { typ: 'tenant_discovery', tenantId: tenant.id },
      {
        secret: this.cfg.get<string>('JWT_SECRET')!,
        expiresIn: DISCOVERY_TTL,
      },
    );

    return {
      ok: true,
      found: true,
      discoveryToken,
      ...publicBrandingPayload(branding, tenant),
    };
  }

  verifyDiscoveryToken(token?: string): { tenantId: string; email?: string } | null {
    if (!token) return null;
    try {
      const payload: any = this.jwt.verify(token, { secret: this.cfg.get<string>('JWT_SECRET')! });
      if (payload?.typ !== 'tenant_discovery' || !payload?.tenantId) return null;
      return { tenantId: payload.tenantId, email: payload.email };
    } catch {
      return null;
    }
  }

  async getPublicBrandingBySlug(slug: string) {
    const tenant = await this.tenantRepo.findOne({ where: { slug } });
    if (!tenant || tenant.status === TenantStatus.SUSPENDED) {
      throw new NotFoundException('Organization not found');
    }
    const brandingRow = await this.brandingRepo.findOne({ where: { tenantId: tenant.id } });
    return publicBrandingPayload(mergeBranding(brandingRow), tenant);
  }

  async getBrandingForUser(user: User) {
    const tenantId =
      user.role === UserRole.SUPER_ADMIN
        ? (await this.ensureDefaultTenant()).id
        : user.tenantId;
    if (!tenantId) {
      const defaults = mergeBranding(null);
      const fallback = await this.ensureDefaultTenant();
      return publicBrandingPayload(defaults, fallback);
    }
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const brandingRow = await this.brandingRepo.findOne({ where: { tenantId } });
    return publicBrandingPayload(mergeBranding(brandingRow), tenant);
  }

  async getDefaults() {
    return { branding: mergeBranding(null) };
  }

  async updateBranding(user: User, dto: UpdateTenantBrandingDto) {
    if (!this.canManageBranding(user)) throw new ForbiddenException('Insufficient permissions');
    const tenantId = user.role === UserRole.SUPER_ADMIN ? user.tenantId || (await this.ensureDefaultTenant()).id : user.tenantId;
    if (!tenantId) throw new BadRequestException('User has no tenant');

    let row = await this.brandingRepo.findOne({ where: { tenantId } });
    if (!row) {
      row = this.brandingRepo.create({ tenantId, ...DEFAULT_BRANDING }) as TenantBranding;
    }
    const before = { ...row };

    for (const [k, v] of Object.entries(dto)) {
      if (v !== undefined) (row as any)[k] = v;
    }
    row.brandingVersion = Number(row.brandingVersion || 1) + 1;
    const saved = await this.brandingRepo.save(row);

    await this.auditRepo.save(
      this.auditRepo.create({
        tenantId,
        actorUserId: user.id,
        action: 'branding.update',
        beforeJson: before as any,
        afterJson: saved as any,
      }),
    );

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    return publicBrandingPayload(mergeBranding(saved), tenant!);
  }

  async resetBranding(user: User) {
    if (!this.canManageBranding(user)) throw new ForbiddenException('Insufficient permissions');
    const tenantId = user.tenantId || (await this.ensureDefaultTenant()).id;
    let row = await this.brandingRepo.findOne({ where: { tenantId } });
    const before = row ? { ...row } : null;
    if (!row) {
      row = this.brandingRepo.create({ tenantId }) as TenantBranding;
    }
    Object.assign(row, DEFAULT_BRANDING);
    row.tenantId = tenantId;
    row.brandingVersion = Number(row.brandingVersion || 1) + 1;
    const saved = await this.brandingRepo.save(row);
    await this.auditRepo.save(
      this.auditRepo.create({
        tenantId,
        actorUserId: user.id,
        action: 'branding.reset',
        beforeJson: before as any,
        afterJson: saved as any,
      }),
    );
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    return publicBrandingPayload(mergeBranding(saved), tenant!);
  }

  async setAssetUrl(user: User, assetType: string, url: string) {
    if (!this.canManageBranding(user)) throw new ForbiddenException('Insufficient permissions');
    if (!ASSET_TYPES.includes(assetType as BrandingAssetType)) {
      throw new BadRequestException(`Invalid asset type. Allowed: ${ASSET_TYPES.join(', ')}`);
    }
    const tenantId = user.tenantId || (await this.ensureDefaultTenant()).id;
    let row = await this.brandingRepo.findOne({ where: { tenantId } });
    if (!row) row = this.brandingRepo.create({ tenantId, ...DEFAULT_BRANDING }) as TenantBranding;
    const field = ASSET_FIELD[assetType as BrandingAssetType];
    (row as any)[field] = url;
    row.brandingVersion = Number(row.brandingVersion || 1) + 1;
    const saved = await this.brandingRepo.save(row);
    await this.auditRepo.save(
      this.auditRepo.create({
        tenantId,
        actorUserId: user.id,
        action: `branding.asset.${assetType}`,
        beforeJson: null,
        afterJson: { [field]: url },
      }),
    );
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    return publicBrandingPayload(mergeBranding(saved), tenant!);
  }

  async clearAsset(user: User, assetType: string) {
    if (!this.canManageBranding(user)) throw new ForbiddenException('Insufficient permissions');
    if (!ASSET_TYPES.includes(assetType as BrandingAssetType)) {
      throw new BadRequestException(`Invalid asset type. Allowed: ${ASSET_TYPES.join(', ')}`);
    }
    const tenantId = user.tenantId || (await this.ensureDefaultTenant()).id;
    let row = await this.brandingRepo.findOne({ where: { tenantId } });
    if (!row) return this.getBrandingForUser(user);
    const field = ASSET_FIELD[assetType as BrandingAssetType];
    (row as any)[field] = null;
    row.brandingVersion = Number(row.brandingVersion || 1) + 1;
    const saved = await this.brandingRepo.save(row);
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    return publicBrandingPayload(mergeBranding(saved), tenant!);
  }

  async createTenant(actor: User, dto: CreateTenantDto) {
    if (actor.role !== UserRole.SUPER_ADMIN) throw new ForbiddenException('Super admin only');
    const base = slugifyTenant(dto.slug || dto.name);
    let slug = base;
    let i = 0;
    while (await this.tenantRepo.findOne({ where: { slug } })) {
      i += 1;
      slug = `${base}-${i}`;
    }
    const license = generateLicenseKey();
    const tenant = await this.tenantRepo.save(
      this.tenantRepo.create({
        name: dto.name,
        slug,
        status: TenantStatus.ACTIVE,
        ownerUserId: dto.ownerUserId || null,
        primaryDomain: dto.primaryDomain || null,
        maxDevices: dto.maxDevices ?? null,
        licenseKeyHash: license.hash,
        licenseKeyPrefix: license.prefix,
        licenseInviteKey: license.raw,
        licenseActive: true,
      }),
    );
    await this.brandingRepo.save(
      this.brandingRepo.create({
        tenantId: tenant.id,
        ...DEFAULT_BRANDING,
        appName: dto.name,
        companyName: dto.name,
      } as any),
    );
    if (dto.ownerUserId) {
      await this.userRepo.update({ id: dto.ownerUserId }, { tenantId: tenant.id, adminId: dto.ownerUserId });
    }
    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        licenseKey: license.raw,
        licenseKeyPrefix: license.prefix,
      },
    };
  }

  async listTenants(actor: User) {
    if (actor.role !== UserRole.SUPER_ADMIN) throw new ForbiddenException('Super admin only');
    const tenants = await this.tenantRepo.find({ order: { created_at: 'DESC' } as any });
    const out = [];
    for (const t of tenants) {
      const usersCount = await this.userRepo.count({ where: { tenantId: t.id } as any });
      const branding = await this.brandingRepo.findOne({ where: { tenantId: t.id } });
      out.push({
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status,
        ownerUserId: t.ownerUserId,
        licenseKeyPrefix: t.licenseKeyPrefix,
        licenseActive: t.licenseActive,
        licenseExpiresAt: t.licenseExpiresAt,
        usersCount,
        brandingVersion: branding?.brandingVersion || 1,
        appName: branding?.appName,
      });
    }
    return { items: out };
  }

  async setTenantStatus(actor: User, tenantId: string, status: TenantStatus) {
    if (actor.role !== UserRole.SUPER_ADMIN) throw new ForbiddenException('Super admin only');
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    tenant.status = status;
    await this.tenantRepo.save(tenant);
    return { id: tenant.id, status: tenant.status };
  }

  async rotateLicense(actor: User, tenantId: string) {
    if (actor.role !== UserRole.SUPER_ADMIN) throw new ForbiddenException('Super admin only');
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const license = this.applyLicense(tenant);
    await this.tenantRepo.save(tenant);
    return { id: tenant.id, licenseKey: license.raw, licenseKeyPrefix: license.prefix };
  }
}
