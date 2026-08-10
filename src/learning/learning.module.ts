import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LearningState } from 'entities/learning.entity';
import { AiFreeModule } from '../ai-free/ai-free.module';
import { MetaWhatsAppModule } from '../meta-whatsapp/meta-whatsapp.module';
import { LearningController } from './learning.controller';
import { LearningService } from './learning.service';
import { LearningUrlFetchService } from './learning-url-fetch.service';

@Module({
	imports: [TypeOrmModule.forFeature([LearningState]), AiFreeModule, MetaWhatsAppModule],
	controllers: [LearningController],
	providers: [LearningService, LearningUrlFetchService],
	exports: [LearningService],
})
export class LearningModule {}
