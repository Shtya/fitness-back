import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { CreateCalorieCalculationDto } from './calorie-calculation.dto';
import { CalorieCalculationService } from './calorie-calculation.service';

@Controller('calorie-calculations')
@UseGuards(JwtAuthGuard)
export class CalorieCalculationController {
	constructor(private readonly calculations: CalorieCalculationService) {}

	@Get()
	list(@Req() req: any) {
		return this.calculations.list(req.user.id);
	}

	@Post()
	create(@Req() req: any, @Body() dto: CreateCalorieCalculationDto) {
		return this.calculations.create(req.user.id, dto);
	}
}
