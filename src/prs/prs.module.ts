import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
	WorkoutSession,
	SessionSet,
	ExercisePR,
	User,
	Plan,
} from 'entities/global.entity';
import { PrsService } from './prs.service';
import { PrsController } from './prs.controller';

@Module({
	imports: [TypeOrmModule.forFeature([WorkoutSession, SessionSet, ExercisePR, User, Plan])],
	controllers: [PrsController],
	providers: [PrsService],
})
export class PrsModule {}
