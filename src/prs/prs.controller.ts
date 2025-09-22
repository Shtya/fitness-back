import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { PrsService } from './prs.service';

@Controller('prs')
export class PrsController {
  constructor(private readonly prs: PrsService) {}

  @Post()
  async upsertDay(@Query('userId') userId: string, @Body() body: { exerciseName: string; date: string; records: Array<{ id?: string; setNumber: number; weight: number; reps: number; done: boolean }> }) {
    const out = await this.prs.upsertDay(userId, body.exerciseName, body.date, body.records || []);
    return { exerciseName: body.exerciseName, date: body.date, records: out };
  }

  // Single set upsert (used by your "Save" button on a row)
  @Post('attempt')
  async upsertAttempt(@Query('userId') userId: string, @Body() body: { exerciseName: string; date: string; set: { id?: string; setNumber: number; weight: number; reps: number; done: boolean } }) {
    const out = await this.prs.upsertDay(userId, body.exerciseName, body.date, [body.set]);
    return { exerciseName: body.exerciseName, date: body.date, records: out };
  }

  // NEW: read back the saved sets for that exercise on that day (to prefill inputs)
  @Get('day/all')
  async getDay(@Query('userId') userId: string, @Query('exerciseName') exerciseName: string, @Query('date') date: string) {
    const out = await this.prs.getDay(userId, exerciseName, date);
    return { exerciseName, date, records: out };
  }

  @Get('last')
  async getLast(@Query('userId') userId: string, @Query('exerciseName') exerciseName: string, @Query('onOrBefore') onOrBefore?: string, @Query('sameWeekday') sameWeekday?: string) {
    const out = await this.prs.getLastExercise(userId, exerciseName, {
      onOrBefore,
      sameWeekday: sameWeekday === 'true',
    });
    return out;
  }

  @Get('next-defaults')
  async getNextDefaults(@Query('userId') userId: string, @Query('exerciseName') exerciseName: string, @Query('targetDate') targetDate: string, @Query('lookbackSameWeekday') lookbackSameWeekday?: string, @Query('onOrBefore') onOrBefore?: string, @Query('mode') mode?: 'weight' | 'reps', @Query('incWeight') incWeight?: string, @Query('incReps') incReps?: string) {
    const out = await this.prs.getNextDefaults(userId, exerciseName, targetDate, {
      lookbackSameWeekday: lookbackSameWeekday === 'true',
      onOrBefore,
      mode: (mode as 'weight' | 'reps') ?? 'weight',
      incWeight: incWeight != null ? Number(incWeight) : undefined,
      incReps: incReps != null ? Number(incReps) : undefined,
    });
    return out;
  }

  @Get('last-day/by-name')
  async getLastDayByName(
    @Query('userId') userId: string,
    @Query('day') day: string, // e.g. ?day=Sunday
    @Query('onOrBefore') onOrBefore?: string,
  ) {
    const out = await this.prs.getLastDayByName(userId, day, { onOrBefore });
    return out;
  }
}
