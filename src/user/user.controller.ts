// src/users/users.controller.ts
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UsersService } from './user.service';
import { CurrentUser } from 'common/decorators/current-user.decorator';
import { RolesGuard } from 'common/guards/roles.guard';
 
@Controller('users')
@UseGuards(RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: any) {
    return this.usersService.me(user.id);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: any, @Body() dto: any) {
    return this.usersService.updateMe(user.id, dto);
  }
}
