import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiReadingState } from 'entities/ai-reading.entity';
import { AiReadingController } from './ai-reading.controller';
import { AiReadingService } from './ai-reading.service';

@Module({
	imports: [TypeOrmModule.forFeature([AiReadingState])],
	controllers: [AiReadingController],
	providers: [AiReadingService],
	exports: [AiReadingService],
})
export class AiReadingModule {}
