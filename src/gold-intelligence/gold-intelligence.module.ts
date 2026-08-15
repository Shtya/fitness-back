import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiFreeModule } from '../ai-free/ai-free.module';
import { GOLD_INTELLIGENCE_ENTITIES } from './entities/gold-intelligence.entity';
import { GoldIntelligenceController } from './gold-intelligence.controller';
import { GoldIntelligenceScheduler } from './gold-intelligence.scheduler';
import { GoldIngestionService } from './services/ingestion.service';
import { GoldIntelligenceService } from './services/intelligence.service';
import { GoldResearchService } from './services/research.service';

@Module({
  imports: [ConfigModule, AiFreeModule, TypeOrmModule.forFeature(GOLD_INTELLIGENCE_ENTITIES)],
  controllers: [GoldIntelligenceController],
  providers: [GoldIngestionService, GoldIntelligenceService, GoldResearchService, GoldIntelligenceScheduler],
  exports: [GoldIntelligenceService],
})
export class GoldIntelligenceModule {}
