import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isUUID } from 'class-validator';
import { User, UserRole } from 'entities/global.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private cfg: ConfigService,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req) => {
          // Prefer Authorization header: Bearer <token>, else cookies 'accessToken'
          const h = req?.headers?.authorization;
          if (h) {
            const [type, token] = h.split(' ');
            if (type === 'Bearer' && token) return token;
          }
          return req?.cookies?.accessToken;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: cfg.get<string>('JWT_SECRET')!,
    });
  }

  async validate(payload: any) {
    const userId = payload?.id || payload?.sub;
    // Legacy numeric ids ("1") must 401 — not QueryFailedError → 400 "Invalid story id"
    // (axios only hard-logouts on 401, so stale tokens otherwise look like empty data).
    if (!userId || !isUUID(String(userId))) {
      throw new UnauthorizedException('Invalid session');
    }
    const user = await this.userRepo.findOne({ where: { id: String(userId) } });
    if (!user) throw new UnauthorizedException('User not found');
    // Prefer DB tenantId; JWT claim is advisory and must not override a different DB tenant.
    if (payload.tenantId && user.tenantId && payload.tenantId !== user.tenantId && user.role !== UserRole.SUPER_ADMIN) {
      throw new UnauthorizedException('Tenant mismatch');
    }
    (user as any).tokenTenantId = payload.tenantId || user.tenantId || null;
    return user;
  }
}
