import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExerciseRecord, User, PlanExercises } from 'entities/global.entity';
import { PrsService } from './prs.service';
import { PrsController } from './prs.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ExerciseRecord, User, PlanExercises])],
  controllers: [PrsController],
  providers: [PrsService],
})
export class PrsModule {}
