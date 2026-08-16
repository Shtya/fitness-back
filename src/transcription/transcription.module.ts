import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
	Transcription,
	TranscriptionProviderCredential,
} from 'entities/transcription.entity';
import { AiFreeModule } from '../ai-free/ai-free.module';
import { TranscriptionController } from './transcription.controller';
import { TranscriptionService } from './transcription.service';

/** WhatsApp-style ASR + AI enhance / summarize / memorize post-processing. */
@Module({
	imports: [
		TypeOrmModule.forFeature([Transcription, TranscriptionProviderCredential]),
		AiFreeModule,
	],
	controllers: [TranscriptionController],
	providers: [TranscriptionService],
	exports: [TranscriptionService],
})
export class TranscriptionModule {}
