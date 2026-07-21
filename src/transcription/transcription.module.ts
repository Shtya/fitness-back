import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
	Transcription,
	TranscriptionProviderCredential,
} from 'entities/transcription.entity';
import { TranscriptionController } from './transcription.controller';
import { TranscriptionService } from './transcription.service';

@Module({
	imports: [TypeOrmModule.forFeature([Transcription, TranscriptionProviderCredential])],
	controllers: [TranscriptionController],
	providers: [TranscriptionService],
})
export class TranscriptionModule {}
