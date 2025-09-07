import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(ctx: ExecutionContext) {
    return super.canActivate(ctx);
  }
  handleRequest(err, user) {
    if (err || !user) throw err || new UnauthorizedException('Authentication failed');
    return user;
  }
}
