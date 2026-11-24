import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { LearnCourse, LearnLecture, LearnRoadmap } from 'entities/learn.entity';
import { LearnLibraryController } from './learn-library.controller';
import { LearnLibraryService } from './learn-library.service';

@Module({
	imports: [TypeOrmModule.forFeature([LearnCourse, LearnLecture, LearnRoadmap]), AiModule],
	controllers: [LearnLibraryController],
	providers: [LearnLibraryService],
})
export class LearnLibraryModule {}
