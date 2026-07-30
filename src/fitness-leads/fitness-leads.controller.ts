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
import { FitnessLeadsService } from './fitness-leads.service';
import { FitnessLeadsCredentialsService } from './fitness-leads-credentials.service';
import {
	SaveFitnessCredentialDto,
	StartFitnessLeadsJobDto,
	SuggestKeywordsDto,
} from './dto/fitness-leads.dto';

@Controller('fitness-leads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FitnessLeadsController {
	constructor(
		private readonly service: FitnessLeadsService,
		private readonly credentials: FitnessLeadsCredentialsService,
	) {}

	@Get('options')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	options() {
		return this.service.options();
	}

	@Post('suggest-keywords')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	suggestKeywords(@Req() req: any, @Body() body: SuggestKeywordsDto) {
		return this.service.suggestKeywords(req.user, body);
	}

	@Get('credentials')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	credentialsList() {
		return this.credentials.listStatus();
	}

	@Put('providers/:provider/credential')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	saveCredential(
		@Req() req: any,
		@Param('provider') provider: string,
		@Body() dto: SaveFitnessCredentialDto,
	) {
		return this.credentials.saveCredential(req.user?.id, provider, dto.fields || {});
	}

	@Delete('providers/:provider/credential')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	removeCredential(@Param('provider') provider: string) {
		return this.credentials.removeCredential(provider);
	}

	@Get('jobs')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	listJobs(@Req() req: any) {
		return this.service.listJobs(req.user?.id);
	}

	@Post('jobs')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	start(@Req() req: any, @Body() body: StartFitnessLeadsJobDto) {
		return this.service.start(req.user?.id, body);
	}

	@Get('jobs/:jobId')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	getJob(@Req() req: any, @Param('jobId') jobId: string) {
		return this.service.getJob(jobId, req.user?.id);
	}

	@Get('leads')
	@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN)
	listLeads(@Req() req: any, @Query('jobId') jobId?: string) {
		return this.service.listLeads(req.user?.id, jobId);
	}
}
