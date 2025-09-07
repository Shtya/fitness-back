// src/sessions/sessions.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkoutSession } from 'entities/global.entity';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [TypeOrmModule.forFeature([WorkoutSession])],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
