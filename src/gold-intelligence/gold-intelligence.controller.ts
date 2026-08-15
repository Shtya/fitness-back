import { Body, Controller, Get, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../entities/global.entity';
import { GoldIngestionService } from './services/ingestion.service';
import { GoldIntelligenceService } from './services/intelligence.service';
import { GoldResearchService } from './services/research.service';
import { CreateGoldAlertDto, GoldResearchDto, SaveGoldSettingsDto } from './dto/gold-intelligence.dto';

const ROLES = [UserRole.ADMIN, UserRole.COACH, UserRole.SUPER_ADMIN, UserRole.CLIENT] as const;

@Controller('gold')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ROLES)
export class GoldIntelligenceController {
  constructor(
    private readonly intelligence: GoldIntelligenceService,
    private readonly ingestion: GoldIngestionService,
    private readonly research: GoldResearchService,
  ) {}

  @Get('intelligence')
  intelligencePayload(@Req() req: any, @Query('refresh') refresh?: string) {
    return this.intelligence.intelligence(refresh === '1', req.user.id);
  }

  @Get('live')
  async live(@Req() req: any) {
    const payload = await this.intelligence.intelligence(false, req.user.id);
    return payload.price;
  }

  @Get('history')
  async history(@Req() req: any) {
    const payload = await this.intelligence.intelligence(false, req.user.id);
    return { bars: payload.history, technical: payload.technical };
  }

  @Get('forecast')
  async forecast(@Req() req: any) {
    const payload = await this.intelligence.intelligence(false, req.user.id);
    return { forecast: payload.forecast, scenarios: payload.scenarios };
  }

  @Get('signal')
  async signal(@Req() req: any) {
    const payload = await this.intelligence.intelligence(false, req.user.id);
    return payload.decision;
  }

  @Get('technical')
  async technical(@Req() req: any) {
    const payload = await this.intelligence.intelligence(false, req.user.id);
    return payload.technical;
  }

  @Get('macro')
  async macro(@Req() req: any) {
    const payload = await this.intelligence.intelligence(false, req.user.id);
    return payload.macro;
  }

  @Get('news')
  async news(@Req() req: any) {
    const payload = await this.intelligence.intelligence(false, req.user.id);
    return payload.news;
  }

  @Get('sentiment')
  async sentiment(@Req() req: any) {
    const payload = await this.intelligence.intelligence(false, req.user.id);
    return { bias: payload.news?.bias, score: payload.news?.score, note: payload.news?.note };
  }

  @Get('events')
  async events(@Req() req: any) {
    const payload = await this.intelligence.intelligence(false, req.user.id);
    return payload.events;
  }

  @Get('central-banks')
  async centralBanks(@Req() req: any) {
    const payload = await this.intelligence.intelligence(false, req.user.id);
    return payload.fundamental?.centralBanks;
  }

  @Get('etfs')
  async etfs(@Req() req: any) {
    const payload = await this.intelligence.intelligence(false, req.user.id);
    return payload.fundamental?.etf;
  }

  @Get('cftc')
  async cftc(@Req() req: any) {
    const payload = await this.intelligence.intelligence(false, req.user.id);
    return payload.positioning;
  }

  @Get('egypt')
  async egypt(@Req() req: any) {
    const payload = await this.intelligence.intelligence(false, req.user.id);
    return payload.egypt;
  }

  @Get('similar-periods')
  async similar(@Req() req: any) {
    const payload = await this.intelligence.intelligence(false, req.user.id);
    return payload.forecast?.similar;
  }

  @Get('model-performance')
  async performance(@Req() req: any) {
    const payload = await this.intelligence.intelligence(false, req.user.id);
    return payload.performance;
  }

  @Get('data-quality')
  async quality(@Req() req: any) {
    const payload = await this.intelligence.intelligence(false, req.user.id);
    return payload.data_quality;
  }

  @Post('ingest')
  ingest() {
    return this.ingestion.ingestAll({ historyDays: 24 });
  }

  @Get('settings')
  settings(@Req() req: any) {
    return this.intelligence.getSettings(req.user.id);
  }

  @Put('settings')
  saveSettings(@Req() req: any, @Body() dto: SaveGoldSettingsDto) {
    return this.intelligence.saveSettings(req.user.id, dto);
  }

  @Get('alerts')
  alerts(@Req() req: any) {
    return this.intelligence.listAlerts(req.user.id);
  }

  @Post('alerts')
  createAlert(@Req() req: any, @Body() dto: CreateGoldAlertDto) {
    return this.intelligence.createAlert(req.user.id, dto);
  }

  @Post('alerts/evaluate')
  async evaluate(@Req() req: any) {
    const payload = await this.intelligence.intelligence(false, req.user.id);
    return this.intelligence.evaluateAlerts(req.user.id, payload);
  }

  @Post('research')
  researchAsk(@Req() req: any, @Body() dto: GoldResearchDto) {
    return this.research.answer(req.user, dto.question, dto.useLlm !== false);
  }
}
