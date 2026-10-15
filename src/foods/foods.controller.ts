import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../entities/global.entity';
import { CreateFoodDto, UpdateFoodDto } from './dto/food.dto';
import { FoodsService } from './foods.service';

const MANAGERS = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.COACH];

@Controller('foods')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FoodsController {
	constructor(private readonly foods: FoodsService) {}

	@Get('search')
	search(@Query('q') q: string, @Query('limit') limit: string, @Req() req: any) {
		return this.foods.search(q, req.user, limit);
	}

	@Get('categories')
	categories(@Req() req: any) {
		return this.foods.categories(req.user);
	}

	@Get()
	@Roles(...MANAGERS)
	list(@Query() query: any, @Req() req: any) {
		return this.foods.list(query, req.user);
	}

	@Get(':id')
	findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
		return this.foods.findOne(id, req.user);
	}

	@Post()
	@Roles(...MANAGERS)
	create(@Body() dto: CreateFoodDto, @Req() req: any) {
		return this.foods.create(dto, req.user);
	}

	@Put(':id')
	@Roles(...MANAGERS)
	update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFoodDto, @Req() req: any) {
		return this.foods.update(id, dto, req.user);
	}

	@Delete(':id')
	@Roles(...MANAGERS)
	remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
		return this.foods.remove(id, req.user);
	}
}
