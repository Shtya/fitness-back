import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { PrsService } from './prs.service';

@Controller('prs')
export class PrsController {
  constructor(private readonly prs: PrsService) {}

  // Bulk upsert sets for a given exercise & day
  @Post()
  async upsertDay(
    @Query('userId') userId: string,
    @Body() body: { exerciseName: string; date: string; records: Array<{ id?: string; setNumber: number; weight: number; reps: number; done: boolean }> },
  ) {
    const out = await this.prs.upsertDay(userId, body.exerciseName, body.date, body.records || []);
    return { exerciseName: body.exerciseName, date: body.date, records: out };
  }

  // Single set upsert (used by your "Save" button on a row)
  @Post('attempt')
  async upsertAttempt(
    @Query('userId') userId: string,
    @Body() body: { exerciseName: string; date: string; set: { id?: string; setNumber: number; weight: number; reps: number; done: boolean } },
  ) {
    const out = await this.prs.upsertDay(userId, body.exerciseName, body.date, [body.set]);
    return { exerciseName: body.exerciseName, date: body.date, records: out };
  }

  // NEW: read back the saved sets for that exercise on that day (to prefill inputs)
  @Get('day')
  async getDay(
    @Query('userId') userId: string,
    @Query('exerciseName') exerciseName: string,
    @Query('date') date: string,
  ) {
    const out = await this.prs.getDay(userId, exerciseName, date);
    return { exerciseName, date, records: out };
  }
}
