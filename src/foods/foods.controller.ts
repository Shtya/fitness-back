import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from 'entities/global.entity';
import { FoodsService } from './foods.service';

@Controller('foods')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FoodsController {
  constructor(private readonly svc: FoodsService) {}

  @Post('bulk')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async bulkCreate(@Body() dto: any) {
    return this.svc.bulkCreate(dto.items);
  }

  @Get('stats')
  async stats(@Query() q: any) {
    return this.svc.stats(q);
  }

  @Get('categories')
  async categories() {
    return this.svc.getCategories();
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async list(@Query() q: any) {
    // Supports: ?page=&limit=&search=&category=
    return this.svc.list(q);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async create(@Body() dto: any) {
    return this.svc.create(dto);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async update(@Param('id') id: string, @Body() dto: any) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  // Food logging endpoints (for clients)
  @Post('log')
  async logFood(@Req() req: any, @Body() dto: any) {
    return this.svc.logFood(req.user.id, dto);
  }

  @Get('logs/my')
  async getMyLogs(@Req() req: any, @Query('date') date?: string) {
    return this.svc.getFoodLogs(req.user.id, date);
  }
}
