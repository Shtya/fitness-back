import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '../redis/redis.module';
import { AiFreeModule } from '../ai-free/ai-free.module';
import {
	FitnessLead,
	FitnessLeadsCredential,
	FitnessLeadsJob,
} from './entities/fitness-leads.entity';
import { FitnessLeadsController } from './fitness-leads.controller';
import { FitnessLeadsService } from './fitness-leads.service';
import { FitnessLeadsCredentialsService } from './fitness-leads-credentials.service';
import { FitnessGooglePlacesService } from './fitness-google-places.service';
import { FitnessOsmService } from './fitness-osm.service';
import { FitnessWebsiteEnrichService } from './fitness-website-enrich.service';
import { FitnessEmailProvidersService } from './fitness-email-providers.service';

@Module({
	imports: [
		ConfigModule,
		RedisModule,
		AiFreeModule,
		TypeOrmModule.forFeature([FitnessLead, FitnessLeadsJob, FitnessLeadsCredential]),
	],
	controllers: [FitnessLeadsController],
	providers: [
		FitnessLeadsService,
		FitnessLeadsCredentialsService,
		FitnessGooglePlacesService,
		FitnessOsmService,
		FitnessWebsiteEnrichService,
		FitnessEmailProvidersService,
	],
	exports: [FitnessLeadsService],
})
export class FitnessLeadsModule {}
