// src/sessions/sessions.controller.ts
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { CurrentUser } from 'common/decorators/current-user.decorator';
import { CreateSessionDto } from './session.dto';
import { RolesGuard } from 'common/guards/roles.guard';

@Controller('sessions')
@UseGuards(RolesGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get('my')
  my(@CurrentUser() user: any) {
    return this.sessions.my(user.id);
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateSessionDto) {
    return this.sessions.create(user.id, dto);
  }
}
