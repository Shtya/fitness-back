import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Post,
	Put,
	Req,
	UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../entities/global.entity';
import { AiService } from './ai.service';
import {
	AiGenerateImageDto,
	AiGenerateTextDto,
	SaveAiCredentialDto,
	UpdateAiFeatureDto,
	UpdateAiLimitsDto,
	UpdateAiModelDto,
	UpdateAiProviderLimitsDto,
	UpsertAiModelDto,
} from './dto/ai.dto';

const MANAGE_ROLES = [UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN] as const;

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...MANAGE_ROLES)
export class AiController {
	constructor(private readonly ai: AiService) {}

	@Get('settings')
	overview(@Req() req: any) {
		return this.ai.overview(req.user);
	}

	@Put('settings/limits')
	updateLimits(@Req() req: any, @Body() dto: UpdateAiLimitsDto) {
		return this.ai.updateLimits(req.user, dto);
	}

	@Put('settings/provider-limits')
	updateProviderLimits(@Req() req: any, @Body() dto: UpdateAiProviderLimitsDto) {
		return this.ai.updateProviderLimits(req.user, dto);
	}

	@Put('settings/features')
	updateFeature(@Req() req: any, @Body() dto: UpdateAiFeatureDto) {
		return this.ai.updateFeatureDefault(req.user, dto);
	}

	@Get('usage')
	usage(@Req() req: any) {
		return this.ai.usage(req.user);
	}

	@Post('credentials/:provider')
	saveCredential(@Req() req: any, @Param('provider') provider: string, @Body() dto: SaveAiCredentialDto) {
		return this.ai.saveCredential(req.user, provider, dto.apiKey);
	}

	@Post('credentials/:provider/test')
	testCredential(@Req() req: any, @Param('provider') provider: string) {
		return this.ai.testCredential(req.user, provider);
	}

	@Delete('credentials/:provider')
	removeCredential(@Req() req: any, @Param('provider') provider: string) {
		return this.ai.removeCredential(req.user, provider);
	}

	@Get('models')
	listModels(@Req() req: any) {
		return this.ai.listModels(req.user);
	}

	@Post('models')
	createModel(@Req() req: any, @Body() dto: UpsertAiModelDto) {
		return this.ai.createModel(req.user, dto);
	}

	@Put('models/:id')
	updateModel(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateAiModelDto) {
		return this.ai.updateModel(req.user, id, dto);
	}

	@Post('models/:id/default')
	setDefault(@Req() req: any, @Param('id') id: string) {
		return this.ai.setDefaultModel(req.user, id);
	}

	@Delete('models/:id')
	removeModel(@Req() req: any, @Param('id') id: string) {
		return this.ai.removeModel(req.user, id);
	}

	@Post('generate/text')
	generateText(@Req() req: any, @Body() dto: AiGenerateTextDto) {
		return this.ai.generateTextFromDto(req.user, dto);
	}

	@Post('generate/image')
	generateImage(@Req() req: any, @Body() dto: AiGenerateImageDto) {
		return this.ai.generateImageFromDto(req.user, dto);
	}
}
