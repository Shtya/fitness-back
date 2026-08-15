import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../entities/global.entity';
import { ProviderManagerService } from './services/provider-manager.service';
import { StudioSecretsService } from './services/studio-secrets.service';
import { PipelineService } from './services/pipeline.service';
import { StudioMediaService } from './services/studio-media.service';
import { KeyInspectorService } from './services/key-inspector.service';
import {
  PublishDto,
  RunPipelineDto,
  SaveConfigDto,
  TestModuleDto,
  UpsertSecretsDto,
} from './dto/studio.dto';

const ROLES = [UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN, UserRole.CLIENT] as const;

@Controller('ai-content-studio')
export class AiContentStudioController {
  constructor(
    private readonly providers: ProviderManagerService,
    private readonly secrets: StudioSecretsService,
    private readonly pipeline: PipelineService,
    private readonly media: StudioMediaService,
    private readonly inspector: KeyInspectorService,
  ) {}

  /** Public media for Meta Instagram image_url fetch */
  @Get('media/:filename')
  async serveMedia(@Param('filename') filename: string, @Res() res: Response) {
    const file = this.media.readFile(filename);
    if (!file) {
      return res.status(404).json({ message: 'Not found' });
    }
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(file.buffer);
  }

  @Get('providers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  listProviders(@Query('type') type?: 'text' | 'image') {
    const all = this.providers.list();
    if (!type) return { providers: all };
    return {
      providers: all.filter((p) =>
        type === 'text'
          ? p.capabilities.supportsText
          : p.capabilities.supportsImage,
      ),
    };
  }

  @Get('providers/:id/help')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  help(@Param('id') id: string) {
    return this.providers.helpFor(id) || { message: 'Unknown provider' };
  }

  @Get('providers/:id/models')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  async models(@Req() req: any, @Param('id') id: string) {
    const secrets = await this.secrets.getSecrets(req.user.id);
    const models = await this.providers.getModels(id, secrets);
    return { provider: id, models };
  }

  @Post('providers/:id/validate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  async validate(@Req() req: any, @Param('id') id: string) {
    const secrets = await this.secrets.getSecrets(req.user.id);
    return this.providers.validate(id, secrets);
  }

  @Get('config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  getConfig(@Req() req: any) {
    return this.pipeline.getConfig(req.user.id);
  }

  @Put('config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  saveConfig(@Req() req: any, @Body() body: SaveConfigDto) {
    return this.pipeline.saveConfig(req.user.id, body.config || (body as any));
  }

  @Get('secrets/inspect')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  inspectSecrets(@Req() req: any, @Query('force') force?: string) {
    return this.inspector.inspectAll(req.user.id, force === '1' || force === 'true');
  }

  @Get('secrets')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  getSecrets(@Req() req: any) {
    return this.secrets.ensureGeminiFromEnv(req.user.id);
  }

  @Put('secrets')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  async upsertSecrets(@Req() req: any, @Body() body: UpsertSecretsDto) {
    try {
      return await this.secrets.upsertSecrets(req.user.id, body.secrets || {});
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Could not save API keys on the server.');
    }
  }

  @Post('test/:module')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  testModule(
    @Req() req: any,
    @Param('module') module: 'topic' | 'content' | 'image' | 'facebook' | 'instagram' | 'comfyui' | 'research',
    @Body() body: TestModuleDto,
  ) {
    return this.pipeline.testModule(req.user.id, module, body);
  }

  @Post('run')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  run(@Req() req: any, @Body() body: RunPipelineDto) {
    const opts = {
      trigger: 'manual' as const,
      publish: body.publishTargets || body.publish || false,
      configOverride: body.configOverride as any,
      resumeFrom: body.resumeFrom,
      onlyModule: body.onlyModule,
    };
    if (body.async && !body.resumeFrom && !body.onlyModule) {
      return this.pipeline.startAsyncPipeline(req.user.id, opts);
    }
    return this.pipeline.runPipeline(req.user.id, opts);
  }

  @Post('retry/:executionId/:module')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  retry(
    @Req() req: any,
    @Param('executionId') executionId: string,
    @Param('module') module: 'topic' | 'content' | 'image' | 'design' | 'facebook' | 'instagram',
  ) {
    return this.pipeline.runPipeline(req.user.id, {
      trigger: 'retry',
      resumeFrom: executionId,
      onlyModule: module,
      publish:
        module === 'facebook' || module === 'instagram'
          ? { facebook: module === 'facebook', instagram: module === 'instagram' }
          : false,
    });
  }

  @Post('publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  publish(@Req() req: any, @Body() body: PublishDto) {
    const facebook = Boolean(body.facebook);
    const instagram = Boolean(body.instagram);
    const onlyModule =
      facebook && !instagram ? 'facebook' : instagram && !facebook ? 'instagram' : undefined;
    return this.pipeline.runPipeline(req.user.id, {
      trigger: 'publish',
      resumeFrom: body.executionId,
      onlyModule,
      publish: { facebook, instagram },
    });
  }

  @Get('history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  history(@Req() req: any, @Query('limit') limit?: string) {
    return this.pipeline.listHistory(req.user.id, limit ? Number(limit) : 30);
  }

  @Get('history/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  async historyOne(@Req() req: any, @Param('id') id: string) {
    const row = await this.pipeline.getExecution(req.user.id, id);
    if (!row) return { message: 'Not found' };
    return this.pipeline.executionToDto(row);
  }

  @Get('defaults')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  defaults() {
    return this.pipeline.defaults();
  }

  @Post('trending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  trending(@Req() req: any) {
    return this.pipeline.discoverTrendingTopics(req.user.id);
  }

  @Post('facebook/test-publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES)
  async fbTestPublish(@Req() req: any, @Body() body: { message?: string }) {
    return this.pipeline.testFacebookPublish(req.user.id, body.message);
  }
}
