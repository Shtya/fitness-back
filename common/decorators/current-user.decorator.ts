// src/common/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  // مؤقتًا لو مافيش Auth: خُد من الهيدر
  if (!req.user) {
    req.user = {
      id: req.headers['x-user-id'],
      role: req.headers['x-user-role'] || 'client',
    };
  }
  return req.user;
});
