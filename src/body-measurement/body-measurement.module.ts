import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BodyMeasurement } from 'entities/profile.entity';
import { User } from 'entities/global.entity';
import { BodyMeasurementController } from './body-measurement.controller';
import { BodyMeasurementService } from './body-measurement.service';
import { BODY_MEASUREMENT_PROVIDER } from './providers/body-measurement.provider';
import { MediaPipeHttpProvider } from './providers/mediapipe-http.provider';

@Module({
	imports: [TypeOrmModule.forFeature([BodyMeasurement, User])],
	controllers: [BodyMeasurementController],
	providers: [
		BodyMeasurementService,
		MediaPipeHttpProvider,
		{
			provide: BODY_MEASUREMENT_PROVIDER,
			useExisting: MediaPipeHttpProvider,
		},
	],
	exports: [BodyMeasurementService],
})
export class BodyMeasurementModule {}
