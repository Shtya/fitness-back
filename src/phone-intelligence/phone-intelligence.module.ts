import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '../redis/redis.module';
import { AiFreeModule } from '../ai-free/ai-free.module';
import {
	PhoneEnrichmentJob,
	PhoneIntelligenceCredential,
	PhoneLookup,
	PhoneReport,
	PhoneSearchSite,
	PublicMatch,
} from './entities/phone-intelligence.entity';
import { PhoneIntelligenceController } from './phone-intelligence.controller';
import { PhoneIntelligenceService } from './phone-intelligence.service';
import { PhoneLookupProvidersService } from './phone-lookup-providers.service';
import { PhonePublicSearchService } from './phone-public-search.service';
import { PhoneCredentialsService } from './phone-credentials.service';
import { PhoneEnrichmentService } from './phone-enrichment.service';
import { PhonePageFetchService } from './phone-page-fetch.service';
import { PhoneSearchSitesService } from './phone-search-sites.service';

@Module({
	imports: [
		ConfigModule,
		RedisModule,
		AiFreeModule,
		TypeOrmModule.forFeature([
			PhoneLookup,
			PhoneReport,
			PublicMatch,
			PhoneIntelligenceCredential,
			PhoneEnrichmentJob,
			PhoneSearchSite,
		]),
	],
	controllers: [PhoneIntelligenceController],
	providers: [
		PhoneIntelligenceService,
		PhoneLookupProvidersService,
		PhonePublicSearchService,
		PhoneCredentialsService,
		PhoneEnrichmentService,
		PhonePageFetchService,
		PhoneSearchSitesService,
	],
	exports: [PhoneIntelligenceService, PhoneCredentialsService, PhoneEnrichmentService],
})
export class PhoneIntelligenceModule {}
