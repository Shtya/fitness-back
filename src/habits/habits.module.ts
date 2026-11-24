import { Body, Controller, Get, Injectable, Logger, Module, OnModuleInit, Put, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsArray, IsOptional, IsString, Matches, ArrayMaxSize } from 'class-validator';
import { Repository } from 'typeorm';
import { HabitTracker } from 'entities/habit-tracker.entity';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { CARDS_MAX, HABITS_MAX, cleanCard, cleanDay, cleanHabit, mergeById } from './habits.util';

/** Production runs with synchronize off: create the table at boot (idempotent, additive). */
const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS habit_trackers (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at timestamptz NOT NULL DEFAULT now(),
		updated_at timestamptz NOT NULL DEFAULT now(),
		deleted_at timestamptz NULL,
		"userId" uuid NOT NULL,
		habits jsonb NOT NULL DEFAULT '[]'::jsonb,
		cards jsonb NOT NULL DEFAULT '[]'::jsonb,
		"planStart" varchar(10) NOT NULL DEFAULT '',
		CONSTRAINT uq_habit_tracker_user UNIQUE ("userId")
	)`,
];

export class HabitsQuery {
	@IsOptional()
	@IsString()
	lang?: string;
}

/** Only what changed: the server merges habits and cards by id. */
export class PutHabitsDto {
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(HABITS_MAX)
	habits?: Record<string, any>[];

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(CARDS_MAX)
	cards?: Record<string, any>[];

	@IsOptional()
	@Matches(/^\d{4}-\d{2}-\d{2}$/)
	planStart?: string;
}

@Injectable()
export class HabitsService implements OnModuleInit {
	private readonly logger = new Logger(HabitsService.name);
	constructor(@InjectRepository(HabitTracker) private readonly repo: Repository<HabitTracker>) {}

	async onModuleInit() {
		try {
			for (const sql of SCHEMA) await this.repo.query(sql);
		} catch (error: any) {
			this.logger.warn(`habit_trackers table not ensured: ${error?.message || error}`);
		}
	}

	private toClient(row: HabitTracker | null) {
		return {
			habits: Array.isArray(row?.habits) ? row!.habits : [],
			cards: Array.isArray(row?.cards) ? row!.cards : [],
			planStart: row?.planStart || '',
		};
	}

	async get(userId: string) {
		return this.toClient(await this.repo.findOne({ where: { userId } }));
	}

	async put(userId: string, dto: PutHabitsDto) {
		let row = await this.repo.findOne({ where: { userId } });
		if (!row) row = this.repo.create({ userId, habits: [], cards: [], planStart: '' });
		if (dto.habits) row.habits = mergeById(row.habits, dto.habits, cleanHabit, HABITS_MAX);
		if (dto.cards) row.cards = mergeById(row.cards, dto.cards, cleanCard, CARDS_MAX);
		if (dto.planStart && cleanDay(dto.planStart)) row.planStart = dto.planStart;
		return this.toClient(await this.repo.save(row));
	}
}

@Controller('habits')
@UseGuards(JwtAuthGuard)
export class HabitsController {
	constructor(private readonly service: HabitsService) {}

	private userId(req: any): string {
		const id = req.user?.id;
		if (!id) throw new UnauthorizedException();
		return String(id);
	}

	@Get()
	get(@Req() req: any, @Query() _query: HabitsQuery) {
		return this.service.get(this.userId(req));
	}

	@Put()
	put(@Req() req: any, @Body() body: PutHabitsDto) {
		return this.service.put(this.userId(req), body);
	}
}

@Module({
	imports: [TypeOrmModule.forFeature([HabitTracker])],
	controllers: [HabitsController],
	providers: [HabitsService],
})
export class HabitsModule {}
