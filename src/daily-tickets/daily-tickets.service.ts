import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DAILY_TICKET_MAX_STEPS, DAILY_TICKET_MAX_TITLE, DailyTicket } from 'entities/daily-ticket.entity';
import { CreateDailyTicketDto, UpdateDailyTicketDto } from './daily-tickets.dto';

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

function localDay(date = new Date()) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** What the client works with: plain values, times as epoch ms. */
export function toClient(row: DailyTicket) {
	return {
		id: row.id,
		no: row.no,
		title: row.title,
		status: row.status,
		done: row.status === 'done',
		priority: row.priority,
		pinned: row.pinned,
		steps: row.steps,
		progress: row.progress,
		day: row.day,
		createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
		doneAt: row.doneAt ? new Date(row.doneAt).getTime() : null,
		notes: row.notes ?? '',
		items: Array.isArray(row.items) ? row.items : [],
	};
}

@Injectable()
export class DailyTicketsService {
	constructor(
		@InjectRepository(DailyTicket) private readonly repo: Repository<DailyTicket>,
		private readonly dataSource: DataSource,
	) {}

	/** Today's board: everything from today plus anything unfinished from earlier days. */
	async list(userId: string, today?: string) {
		const qb = this.repo.createQueryBuilder('t').where('t.userId = :userId', { userId });
		if (today) qb.andWhere("(t.day = :today OR t.status <> 'done')", { today });
		const rows = await qb.orderBy('t.orderIndex', 'ASC').addOrderBy('t.created_at', 'ASC').getMany();
		return { tickets: rows.map(toClient) };
	}

	async create(userId: string, dto: CreateDailyTicketDto) {
		const title = String(dto.title ?? '').trim().slice(0, DAILY_TICKET_MAX_TITLE);
		if (!title) throw new BadRequestException('title is required');

		if (dto.id) {
			const existing = await this.repo.findOne({ where: { id: dto.id } });
			if (existing) {
				if (existing.userId !== userId) throw new ConflictException('Ticket id already in use');
				return toClient(existing); // a retried request: already saved
			}
		}

		return this.dataSource.transaction(async manager => {
			const repo = manager.getRepository(DailyTicket);
			const stats = await repo
				.createQueryBuilder('t')
				.select('COALESCE(MAX(t.no), 0)', 'maxNo')
				.addSelect('COALESCE(MAX(t.orderIndex), -1)', 'maxOrder')
				.where('t.userId = :userId', { userId })
				.getRawOne<{ maxNo: string; maxOrder: string }>();

			let orderIndex = Number(stats?.maxOrder ?? -1) + 1;
			if (Number.isInteger(dto.index) && dto.index! < orderIndex) {
				// Putting a ticket back in its old slot (undo): make room.
				orderIndex = dto.index!;
				await repo
					.createQueryBuilder()
					.update(DailyTicket)
					.set({ orderIndex: () => '"orderIndex" + 1' })
					.where('userId = :userId AND "orderIndex" >= :orderIndex', { userId, orderIndex })
					.execute();
			}

			const row = repo.create({
				...(dto.id ? { id: dto.id } : {}),
				userId,
				no: dto.no ?? Number(stats?.maxNo ?? 0) + 1,
				title,
				status: 'todo',
				priority: 'medium',
				pinned: false,
				steps: 1,
				progress: 0,
				day: dto.day ?? localDay(),
				doneAt: null,
				orderIndex,
				notes: '',
				items: [],
			});
			this.apply(row, dto);
			if (dto.createdAt) row.created_at = new Date(dto.createdAt);
			return toClient(await repo.save(row));
		});
	}

	async update(userId: string, id: string, dto: UpdateDailyTicketDto) {
		const row = await this.repo.findOne({ where: { id, userId } });
		if (!row) throw new NotFoundException('Ticket not found');
		if (dto.title !== undefined) {
			const title = String(dto.title).trim().slice(0, DAILY_TICKET_MAX_TITLE);
			if (!title) throw new BadRequestException('title is required');
			dto.title = title;
		}
		this.apply(row, dto);
		return toClient(await this.repo.save(row));
	}

	async remove(userId: string, id: string) {
		const res = await this.repo.delete({ id, userId });
		if (!res.affected) throw new NotFoundException('Ticket not found');
		return { id };
	}

	/** Saves the order the board shows; tickets not listed keep their place after those. */
	async reorder(userId: string, ids: string[]) {
		const rows = await this.repo.find({ where: { userId }, order: { orderIndex: 'ASC', created_at: 'ASC' } });
		const byId = new Map(rows.map(r => [r.id, r]));
		const ordered = [...new Set(ids)].map(id => byId.get(id)).filter((r): r is DailyTicket => Boolean(r));
		const rest = rows.filter(r => !ordered.includes(r));
		const next = [...ordered, ...rest];
		const changed = next.filter((r, i) => r.orderIndex !== i);
		if (changed.length) {
			await this.dataSource.transaction(async manager => {
				for (const r of changed) await manager.update(DailyTicket, { id: r.id, userId }, { orderIndex: next.indexOf(r) });
			});
		}
		return { ids: next.map(r => r.id) };
	}

	/** One-time move of tickets that used to live only in the browser. */
	async import(userId: string, items: CreateDailyTicketDto[]) {
		const saved = [];
		// Numbered after the tickets already in the account, in their old order.
		for (const item of items) saved.push(await this.create(userId, { ...item, index: undefined, no: undefined }));
		return { tickets: saved };
	}

	/** Copies the given fields and keeps status, progress and doneAt consistent. */
	private apply(row: DailyTicket, dto: UpdateDailyTicketDto) {
		if (dto.title !== undefined) row.title = dto.title;
		if (dto.priority !== undefined) row.priority = dto.priority;
		if (dto.pinned !== undefined) row.pinned = dto.pinned;
		if (dto.day !== undefined) row.day = dto.day;
		if (dto.notes !== undefined) row.notes = dto.notes;
		if (dto.items !== undefined) row.items = dto.items.map(i => ({ id: String(i.id), text: String(i.text).trim(), done: Boolean(i.done) })).filter(i => i.text);
		if (dto.steps !== undefined) row.steps = clamp(dto.steps, 1, DAILY_TICKET_MAX_STEPS);
		if (dto.progress !== undefined) row.progress = dto.progress;
		if (dto.status !== undefined) row.status = dto.status;
		else if (dto.progress !== undefined || dto.steps !== undefined) {
			row.status = row.progress >= row.steps ? 'done' : row.progress > 0 ? 'doing' : row.status === 'done' ? 'todo' : row.status;
		}

		row.progress = clamp(row.progress, 0, row.steps);
		if (row.status === 'done') row.progress = row.steps;
		else if (row.progress >= row.steps) row.progress = row.steps - 1;

		if (row.status === 'done') {
			row.doneAt = typeof dto.doneAt === 'number' ? new Date(dto.doneAt) : (row.doneAt ?? new Date());
		} else {
			row.doneAt = null;
		}
	}
}
