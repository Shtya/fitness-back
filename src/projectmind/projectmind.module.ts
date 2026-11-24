import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { AiJsonService } from './ai-json.service';
import { ChatService } from './chat.service';
import { DocsService } from './docs.service';
import { PM_ENTITIES } from './entities/projectmind.entities';
import { GapsService } from './gaps.service';
import { MeetingsService } from './meetings.service';
import { ProjectMindController } from './projectmind.controller';
import { ProjectsService } from './projects.service';
import { RetrievalService } from './retrieval.service';
import { SettingsService } from './settings.service';
import { SimulatorService } from './simulator.service';

/** ProjectMind AI: self-contained module. Uses the shared AiModule for provider keys, limits and usage tracking. */
@Module({
	imports: [TypeOrmModule.forFeature(PM_ENTITIES), AiModule],
	controllers: [ProjectMindController],
	providers: [ProjectsService, RetrievalService, DocsService, GapsService, ChatService, MeetingsService, SimulatorService, AiJsonService, SettingsService],
})
export class ProjectMindModule {}
