import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from 'entities/global.entity';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.get<UserRole[]>('roles', ctx.getHandler());
    if (!required?.length) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user as { role?: UserRole };
    if (!user) throw new ForbiddenException('User not authenticated');

    if (!required.includes(user.role as UserRole)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
    }
}
