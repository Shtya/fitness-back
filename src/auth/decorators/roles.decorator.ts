import { SetMetadata } from '@nestjs/common';
import { UserRole } from 'entities/global.entity';

export const Roles = (...roles: UserRole[]) => SetMetadata('roles', roles);
