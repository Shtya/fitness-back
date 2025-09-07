import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PersonalRecordsService } from './personal-records.service';
import { AttemptPrDto, CreatePersonalRecordDto, HistoryQueryDto, OverviewQueryDto, QueryPrDto, UpdatePersonalRecordDto } from 'dto/personal-records.dto';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from 'common/guards/roles.guard';

@Controller('prs')
@UseGuards(RolesGuard)
@UseGuards(AuthGuard('jwt'))
export class PersonalRecordsController {
  constructor(private readonly service: PersonalRecordsService) {}

  /** Create-or-edit this day (no-op if identical) */
  @Post()
  create(@Req() req: any, @Body() dto: CreatePersonalRecordDto) {
    return this.service.create(req.user.id, dto);
  }

  /** Upsert a single set (append/replace by setNumber) on this day */
  @Post('attempt')
  attempt(@Req() req: any, @Body() dto: AttemptPrDto) {
    return this.service.attempt(req.user.id, dto);
  }

  @Get()
  list(@Req() req: any, @Query() q: QueryPrDto) {
    return this.service.list(req.user.id, q);
  }

  @Get(':id')
  get(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(req.user.id, id);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdatePersonalRecordDto) {
    return this.service.update(req.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.remove(req.user.id, id);
  }

  // ----- STATS -----
  @Get('stats/overview')
  overview(@Req() req: any, @Query() q: OverviewQueryDto) {
    return this.service.overview(req.user.id, q.windowDays);
  }

  @Get('stats/e1rm-series')
  e1rmSeries(@Req() req: any, @Query() q: HistoryQueryDto) {
    return this.service.e1rmSeries(req.user.id, q.exerciseName, q.bucket ?? 'week', q.windowDays ?? 90);
  }

  @Get('stats/top-sets')
  topSets(@Req() req: any, @Query('exerciseName') exerciseName: string, @Query('top') top?: string) {
    return this.service.topSets(req.user.id, exerciseName, Number(top ?? 5));
  }

  @Get('history')
  history(@Req() req: any, @Query('exerciseName') exerciseName: string) {
    return this.service.attemptsHistory(req.user.id, exerciseName);
  }
}
