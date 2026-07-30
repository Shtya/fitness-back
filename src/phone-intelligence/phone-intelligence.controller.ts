import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Post,
	Put,
	Query,
	Req,
	UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../entities/global.entity';
import { PhoneIntelligenceService } from './phone-intelligence.service';
import { PhoneCredentialsService } from './phone-credentials.service';
import { PhoneEnrichmentService } from './phone-enrichment.service';
import { PhoneSearchSitesService } from './phone-search-sites.service';
import {
	CreatePhoneReportDto,
	LookupPhoneDto,
	SavePhoneProviderCredentialDto,
	AnalyzePhoneReportDto,
	UpsertPhoneSearchSiteDto,
} from './dto/phone-intelligence.dto';

@Controller('phone-intelligence')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PhoneIntelligenceController {
	constructor(
		private readonly service: PhoneIntelligenceService,
		private readonly credentials: PhoneCredentialsService,
		private readonly enrichment: PhoneEnrichmentService,
		private readonly searchSites: PhoneSearchSitesService,
	) {}

	@Get('providers')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN, UserRole.CLIENT)
	providers() {
		return this.service.providersStatus();
	}

	@Get('credentials')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN, UserRole.CLIENT)
	credentialsList() {
		return this.credentials.listStatus();
	}

	@Get('providers/:provider/credential')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN, UserRole.CLIENT)
	credentialStatus(@Param('provider') provider: string) {
		return this.credentials.credentialStatus(provider);
	}

	@Put('providers/:provider/credential')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	saveCredential(
		@Req() req: any,
		@Param('provider') provider: string,
		@Body() dto: SavePhoneProviderCredentialDto,
	) {
		return this.credentials.saveCredential(req.user?.id, provider, dto.fields || {});
	}

	@Delete('providers/:provider/credential')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	removeCredential(@Param('provider') provider: string) {
		return this.credentials.removeCredential(provider);
	}

	@Get('search-sites')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN, UserRole.CLIENT)
	listSearchSites() {
		return this.searchSites.list();
	}

	@Post('search-sites')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	createSearchSite(@Body() dto: UpsertPhoneSearchSiteDto) {
		return this.searchSites.create(dto);
	}

	@Put('search-sites/:id')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	updateSearchSite(@Param('id') id: string, @Body() dto: UpsertPhoneSearchSiteDto) {
		return this.searchSites.update(id, dto);
	}

	@Delete('search-sites/:id')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	removeSearchSite(@Param('id') id: string) {
		return this.searchSites.remove(id);
	}

	@Get('categories')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN, UserRole.CLIENT)
	categories() {
		return this.service.categories();
	}

	@Post('lookup')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN, UserRole.CLIENT)
	lookup(@Req() req: any, @Body() body: LookupPhoneDto) {
		const ip =
			req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
			req.ip ||
			req.socket?.remoteAddress;
		return this.service.lookup(req.user?.id, body, ip);
	}

	/** Start background multi-source enrichment (poll with GET enrich/:jobId). */
	@Post('enrich')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN, UserRole.CLIENT)
	startEnrich(@Req() req: any, @Body() body: LookupPhoneDto) {
		const ip =
			req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
			req.ip ||
			req.socket?.remoteAddress;
		return this.enrichment.start(req.user?.id, body, ip);
	}

	@Get('enrich/:jobId')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN, UserRole.CLIENT)
	getEnrichJob(@Req() req: any, @Param('jobId') jobId: string) {
		return this.enrichment.getJob(jobId, req.user?.id);
	}

	@Post('analyze')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN, UserRole.CLIENT)
	analyze(@Req() req: any, @Body() body: AnalyzePhoneReportDto) {
		return this.service.analyzeWithAi(req.user, body.report || {}, body.locale);
	}

	@Post('reports')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN, UserRole.CLIENT)
	createReport(@Req() req: any, @Body() body: CreatePhoneReportDto) {
		const ip =
			req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
			req.ip ||
			req.socket?.remoteAddress;
		return this.service.createReport(req.user?.id, body, ip);
	}

	@Get('reports')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN, UserRole.CLIENT)
	listReports(
		@Query('phone') phone: string,
		@Query('countryCode') countryCode?: string,
	) {
		return this.service.listReports(phone, countryCode);
	}
}
