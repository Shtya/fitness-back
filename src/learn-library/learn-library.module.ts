import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LearnCourse, LearnLecture } from 'entities/learn.entity';
import { LearnLibraryController } from './learn-library.controller';
import { LearnLibraryService } from './learn-library.service';

@Module({
	imports: [TypeOrmModule.forFeature([LearnCourse, LearnLecture])],
	controllers: [LearnLibraryController],
	providers: [LearnLibraryService],
})
export class LearnLibraryModule {}
