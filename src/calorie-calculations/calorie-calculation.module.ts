import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalorieCalculationController } from './calorie-calculation.controller';
import { CalorieCalculation } from './calorie-calculation.entity';
import { CalorieCalculationService } from './calorie-calculation.service';

@Module({
	imports: [TypeOrmModule.forFeature([CalorieCalculation])],
	controllers: [CalorieCalculationController],
	providers: [CalorieCalculationService],
})
export class CalorieCalculationModule {}
