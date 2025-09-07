// src/coaching/coaching.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserCoach } from 'entities/global.entity';
import { CoachingService } from './conaching.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserCoach])],
  providers: [CoachingService],
  exports: [CoachingService],
})
export class CoachingModule {}
