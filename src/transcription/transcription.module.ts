import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
	Transcription,
	TranscriptionProviderCredential,
} from 'entities/transcription.entity';
import { AiFreeModule } from '../ai-free/ai-free.module';
import { TranscriptionController } from './transcription.controller';
import { TranscriptionService } from './transcription.service';

/** WhatsApp-style ASR + AI enhance/memorize post-processing. */
@Module({
	imports: [
		TypeOrmModule.forFeature([Transcription, TranscriptionProviderCredential]),
		AiFreeModule,
	],
	controllers: [TranscriptionController],
	providers: [TranscriptionService],
})
export class TranscriptionModule {}
