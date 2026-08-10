import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../entities/global.entity';
import { LearningService } from './learning.service';
import { LearningAiDto, LearningFetchUrlDto, LearningImportUrlDto, LearningRoadmapTopicDto, LearningSearchRoadmapsDto, LearningTranslateDto, LearningVideoTranscriptDto } from './dto/learning.dto';

@Controller('learning')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN, UserRole.CLIENT)
export class LearningController {
	constructor(private readonly service: LearningService) {}

	@Get('state')
	getState(@Req() req: any) {
		return this.service.getState(req.user);
	}

	@Put('state')
	putState(@Req() req: any, @Body() body: any) {
		return this.service.putState(req.user, body);
	}

	@Post('ai')
	ai(@Req() req: any, @Body() body: LearningAiDto) {
		return this.service.aiAssist(req.user, body);
	}

	@Post('fetch-url')
	fetchUrl(@Req() req: any, @Body() body: LearningFetchUrlDto) {
		return this.service.fetchUrl(req.user, body.url);
	}

	@Post('import-url')
	importUrl(@Req() req: any, @Body() body: LearningImportUrlDto) {
		return this.service.importFromUrl(req.user, body);
	}

	@Post('roadmap-topic')
	roadmapTopic(@Req() req: any, @Body() body: LearningRoadmapTopicDto) {
		return this.service.getOfficialTopicDetail(req.user, body);
	}

	@Post('search-roadmaps')
	searchRoadmaps(@Req() req: any, @Body() body: LearningSearchRoadmapsDto) {
		return this.service.searchRoadmaps(req.user, body);
	}

	@Get('official-roadmaps')
	officialRoadmaps(@Req() req: any) {
		return this.service.listOfficialRoadmapsCatalog(req.user);
	}

	@Post('video-transcript')
	videoTranscript(@Req() req: any, @Body() body: LearningVideoTranscriptDto) {
		return this.service.fetchVideoTranscript(req.user, body.url);
	}

	@Post('translate')
	translate(@Req() req: any, @Body() body: LearningTranslateDto) {
		return this.service.translateTexts(req.user, body);
	}
}
