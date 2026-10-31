import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { LEARN_MAX_TITLE, LearnCourse, LearnLecture, LearnRoadmap } from 'entities/learn.entity';
import { CreateCourseDto, CreateLectureDto, UpdateCourseDto, UpdateLectureDto } from './learn-library.dto';
import { LEARN_SCHEMA_STATEMENTS } from './learn-library.schema';
import { NormalizedRoadmap, mergeTopicsIndex, parseRoadmapJson, parseTopicsIndexJson, roadmapTopicKeys } from './learn-roadmap.util';

const ms = (date: Date | null | undefined) => (date ? new Date(date).getTime() : null);

/** Plain text of a lecture field (the editor stores HTML or Markdown). */
export function plainText(source: string) {
	return String(source || '')
		.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/[#*_`>~]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** A short piece of `text` around the first match of `query`. */
export function snippetAround(text: string, query: string, radius = 70) {
	const plain = plainText(text);
	const at = plain.toLowerCase().indexOf(query.toLowerCase());
	if (at < 0) return '';
	const start = Math.max(0, at - radius);
	const end = Math.min(plain.length, at + query.length + radius);
	return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`;
}

/** Escapes LIKE wildcards so a search for "100%" means the text "100%". */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;

type CourseStats = { lectures: number; done: number; revision: number };

export function courseToClient(row: LearnCourse, stats: CourseStats = { lectures: 0, done: 0, revision: 0 }) {
	return {
		id: row.id,
		title: row.title,
		description: row.description ?? '',
		category: row.category ?? '',
		color: row.color || 'green',
		pinned: Boolean(row.pinned),
		createdAt: ms(row.created_at) ?? Date.now(),
		updatedAt: ms(row.updated_at) ?? Date.now(),
		lastStudiedAt: ms(row.lastStudiedAt),
		lectures: stats.lectures,
		done: stats.done,
		revision: stats.revision,
	};
}

/** The lecture list row: everything except the long text, which is loaded when opened. */
export function lectureSummaryToClient(row: LearnLecture) {
	return {
		id: row.id,
		courseId: row.courseId,
		title: row.title,
		description: row.description ?? '',
		done: Boolean(row.done),
		doneAt: ms(row.doneAt),
		needsRevision: Boolean(row.needsRevision),
		qaCount: Array.isArray(row.qa) ? row.qa.length : 0,
		hasContent: Boolean(String(row.content || '').trim()),
		createdAt: ms(row.created_at) ?? Date.now(),
		updatedAt: ms(row.updated_at) ?? Date.now(),
	};
}

export function lectureToClient(row: LearnLecture) {
	return {
		...lectureSummaryToClient(row),
		content: row.content ?? '',
		notes: row.notes ?? '',
		keyPoints: row.keyPoints ?? '',
		summary: row.summary ?? '',
		qa: Array.isArray(row.qa) ? row.qa : [],
	};
}

/** Personal learning library: every query is scoped to the signed-in user's own rows. */
@Injectable()
export class LearnLibraryService implements OnModuleInit {
	private readonly logger = new Logger(LearnLibraryService.name);
	private schemaReady: Promise<boolean> | null = null;

	constructor(
		@InjectRepository(LearnCourse) private readonly courses: Repository<LearnCourse>,
		@InjectRepository(LearnLecture) private readonly lectures: Repository<LearnLecture>,
		@InjectRepository(LearnRoadmap) private readonly roadmaps: Repository<LearnRoadmap>,
		private readonly dataSource: DataSource,
	) {}

	onModuleInit() {
		return this.ensureSchema();
	}

	/**
	 * Creates the Learn tables if this database does not have them yet (boot, and again on the
	 * next library load if the boot attempt failed, e.g. the database was briefly unreachable).
	 */
	ensureSchema() {
		if (!this.schemaReady) {
			this.schemaReady = (async () => {
				try {
					for (const statement of LEARN_SCHEMA_STATEMENTS) await this.dataSource.query(statement);
					return true;
				} catch (error) {
					this.logger.error(`Could not ensure Learn tables: ${error instanceof Error ? error.message : error}`);
					this.schemaReady = null;
					return false;
				}
			})();
		}
		return this.schemaReady;
	}

	private async statsFor(userId: string, courseIds?: string[]) {
		const qb = this.lectures
			.createQueryBuilder('l')
			.select('l.courseId', 'courseId')
			.addSelect('COUNT(*)', 'lectures')
			.addSelect('COUNT(*) FILTER (WHERE l.done)', 'done')
			.addSelect('COUNT(*) FILTER (WHERE l.needsRevision)', 'revision')
			.where('l.userId = :userId', { userId })
			.groupBy('l.courseId');
		if (courseIds?.length) qb.andWhere('l.courseId IN (:...courseIds)', { courseIds });
		const rows = await qb.getRawMany<{ courseId: string; lectures: string; done: string; revision: string }>();
		return new Map<string, CourseStats>(
			rows.map(r => [r.courseId, { lectures: Number(r.lectures) || 0, done: Number(r.done) || 0, revision: Number(r.revision) || 0 }]),
		);
	}

	private async ownCourse(userId: string, id: string) {
		const row = await this.courses.findOne({ where: { id, userId } });
		if (!row) throw new NotFoundException('Course not found');
		return row;
	}

	private async ownLecture(userId: string, id: string) {
		const row = await this.lectures.findOne({ where: { id, userId } });
		if (!row) throw new NotFoundException('Lecture not found');
		return row;
	}

	private async courseResult(userId: string, row: LearnCourse) {
		const stats = await this.statsFor(userId, [row.id]);
		return courseToClient(row, stats.get(row.id));
	}

	async listCourses(userId: string) {
		await this.ensureSchema();
		const rows = await this.courses.find({ where: { userId }, order: { orderIndex: 'ASC', created_at: 'ASC' } });
		const stats = await this.statsFor(userId);
		return { courses: rows.map(row => courseToClient(row, stats.get(row.id))) };
	}

	async createCourse(userId: string, dto: CreateCourseDto) {
		const title = String(dto.title || '').trim().slice(0, LEARN_MAX_TITLE);
		if (!title) throw new BadRequestException('title is required');
		const max = await this.courses
			.createQueryBuilder('c')
			.select('COALESCE(MAX(c.orderIndex), -1)', 'max')
			.where('c.userId = :userId', { userId })
			.getRawOne<{ max: string }>();
		const row = this.courses.create({
			userId,
			title,
			description: String(dto.description || '').trim(),
			category: String(dto.category || '').trim(),
			color: dto.color || 'green',
			pinned: Boolean(dto.pinned),
			orderIndex: Number(max?.max ?? -1) + 1,
			lastStudiedAt: null,
		});
		return courseToClient(await this.courses.save(row));
	}

	async updateCourse(userId: string, id: string, dto: UpdateCourseDto) {
		const row = await this.ownCourse(userId, id);
		if (dto.title !== undefined) {
			const title = dto.title.trim();
			if (!title) throw new BadRequestException('title is required');
			row.title = title;
		}
		if (dto.description !== undefined) row.description = dto.description.trim();
		if (dto.category !== undefined) row.category = dto.category.trim();
		if (dto.color !== undefined) row.color = dto.color;
		if (dto.pinned !== undefined) row.pinned = dto.pinned;
		return this.courseResult(userId, await this.courses.save(row));
	}

	/** Soft delete: the course and its lectures leave the library (rows stay recoverable). */
	async removeCourse(userId: string, id: string) {
		await this.ownCourse(userId, id);
		await this.dataSource.transaction(async manager => {
			await manager.softDelete(LearnLecture, { userId, courseId: id });
			await manager.softDelete(LearnCourse, { userId, id });
		});
		return { id };
	}

	async reorderCourses(userId: string, ids: string[]) {
		const rows = await this.courses.find({ where: { userId }, order: { orderIndex: 'ASC', created_at: 'ASC' } });
		return { ids: await this.applyOrder(LearnCourse, userId, rows, ids) };
	}

	/** Writes the new positions; ids the client did not list keep their relative order after. */
	private async applyOrder<T extends LearnCourse | LearnLecture>(entity: new () => T, userId: string, rows: T[], ids: string[]) {
		const byId = new Map(rows.map(r => [r.id, r]));
		const ordered = [...new Set(ids)].map(id => byId.get(id)).filter((r): r is T => Boolean(r));
		const next = [...ordered, ...rows.filter(r => !ordered.includes(r))];
		const changed = next.filter((r, i) => r.orderIndex !== i);
		if (changed.length) {
			await this.dataSource.transaction(async manager => {
				for (const r of changed) await manager.update(entity, { id: r.id, userId }, { orderIndex: next.indexOf(r) } as any);
			});
		}
		return next.map(r => r.id);
	}

	async listLectures(userId: string, courseId: string) {
		const course = await this.ownCourse(userId, courseId);
		const rows = await this.lectures.find({
			where: { userId, courseId },
			order: { orderIndex: 'ASC', created_at: 'ASC' },
		});
		const stats = { lectures: rows.length, done: rows.filter(r => r.done).length, revision: rows.filter(r => r.needsRevision).length };
		return { course: courseToClient(course, stats), lectures: rows.map(lectureSummaryToClient) };
	}

	async createLecture(userId: string, courseId: string, dto: CreateLectureDto) {
		await this.ownCourse(userId, courseId);
		const title = String(dto.title || '').trim().slice(0, LEARN_MAX_TITLE);
		if (!title) throw new BadRequestException('title is required');
		const max = await this.lectures
			.createQueryBuilder('l')
			.select('COALESCE(MAX(l.orderIndex), -1)', 'max')
			.where('l.userId = :userId AND l.courseId = :courseId', { userId, courseId })
			.getRawOne<{ max: string }>();
		const row = this.lectures.create({
			userId,
			courseId,
			title,
			description: String(dto.description || '').trim(),
			content: dto.content ?? '',
			notes: dto.notes ?? '',
			keyPoints: dto.keyPoints ?? '',
			summary: dto.summary ?? '',
			qa: dto.qa ?? [],
			done: Boolean(dto.done),
			doneAt: dto.done ? new Date() : null,
			needsRevision: Boolean(dto.needsRevision),
			orderIndex: Number(max?.max ?? -1) + 1,
		});
		const saved = await this.lectures.save(row);
		await this.touchCourse(userId, courseId);
		return lectureToClient(saved);
	}

	async getLecture(userId: string, id: string) {
		const row = await this.ownLecture(userId, id);
		await this.touchCourse(userId, row.courseId);
		return lectureToClient(row);
	}

	/** Partial update: only the fields sent are written, so two open sections never overwrite each other. */
	async updateLecture(userId: string, id: string, dto: UpdateLectureDto) {
		const row = await this.ownLecture(userId, id);
		const patch: Partial<LearnLecture> = {};
		if (dto.title !== undefined) {
			const title = dto.title.trim();
			if (!title) throw new BadRequestException('title is required');
			patch.title = title;
		}
		if (dto.description !== undefined) patch.description = dto.description.trim();
		if (dto.content !== undefined) patch.content = dto.content;
		if (dto.notes !== undefined) patch.notes = dto.notes;
		if (dto.keyPoints !== undefined) patch.keyPoints = dto.keyPoints;
		if (dto.summary !== undefined) patch.summary = dto.summary;
		if (dto.qa !== undefined) patch.qa = dto.qa.map(item => ({ id: item.id, q: item.q, a: item.a }));
		if (dto.needsRevision !== undefined) patch.needsRevision = dto.needsRevision;
		if (dto.done !== undefined && dto.done !== row.done) {
			patch.done = dto.done;
			patch.doneAt = dto.done ? new Date() : null;
		}
		if (Object.keys(patch).length) await this.lectures.update({ id, userId }, patch);
		await this.touchCourse(userId, row.courseId);
		return lectureToClient(await this.ownLecture(userId, id));
	}

	async removeLecture(userId: string, id: string) {
		const row = await this.ownLecture(userId, id);
		await this.lectures.softDelete({ id, userId });
		return { id, courseId: row.courseId };
	}

	async reorderLectures(userId: string, courseId: string, ids: string[]) {
		await this.ownCourse(userId, courseId);
		const rows = await this.lectures.find({ where: { userId, courseId }, order: { orderIndex: 'ASC', created_at: 'ASC' } });
		return { ids: await this.applyOrder(LearnLecture, userId, rows, ids) };
	}

	/** Every lecture flagged "needs revision", newest change first. */
	async revision(userId: string) {
		const rows = await this.lectures.find({ where: { userId, needsRevision: true }, order: { updated_at: 'DESC' }, take: 300 });
		const courseIds = [...new Set(rows.map(r => r.courseId))];
		const courses = courseIds.length ? await this.courses.findBy(courseIds.map(id => ({ id, userId }))) : [];
		const titles = new Map(courses.map(c => [c.id, c.title]));
		return {
			lectures: rows
				.filter(r => titles.has(r.courseId))
				.map(r => ({ ...lectureSummaryToClient(r), courseTitle: titles.get(r.courseId) || '' })),
		};
	}

	/** Courses and lectures whose text contains `q` (titles, description, content and study sections). */
	async search(userId: string, rawQuery: string) {
		const q = String(rawQuery || '').trim();
		if (q.length < 2) return { courses: [], lectures: [] };
		const pattern = likePattern(q);
		const courses = await this.courses
			.createQueryBuilder('c')
			.where('c.userId = :userId', { userId })
			.andWhere(
				new Brackets(w => {
					w.where('c.title ILIKE :pattern', { pattern })
						.orWhere('c.description ILIKE :pattern', { pattern })
						.orWhere('c.category ILIKE :pattern', { pattern });
				}),
			)
			.orderBy('c.orderIndex', 'ASC')
			.take(20)
			.getMany();
		const fields = ['title', 'description', 'content', 'notes', 'keyPoints', 'summary'] as const;
		const lectures = await this.lectures
			.createQueryBuilder('l')
			.where('l.userId = :userId', { userId })
			.andWhere(
				new Brackets(w => {
					for (const field of fields) w.orWhere(`l.${field} ILIKE :pattern`, { pattern });
					w.orWhere('l.qa::text ILIKE :pattern', { pattern });
				}),
			)
			.orderBy('l.updated_at', 'DESC')
			.take(40)
			.getMany();
		const courseIds = [...new Set(lectures.map(l => l.courseId))];
		const owners = courseIds.length ? await this.courses.findBy(courseIds.map(id => ({ id, userId }))) : [];
		const titles = new Map(owners.map(c => [c.id, c.title]));
		return {
			courses: courses.map(c => courseToClient(c)),
			lectures: lectures
				.filter(l => titles.has(l.courseId))
				.map(l => {
					const field =
						fields.find(f => plainText(String(l[f] || '')).toLowerCase().includes(q.toLowerCase())) ||
						(l.qa?.some(item => `${item.q} ${item.a}`.toLowerCase().includes(q.toLowerCase())) ? 'qa' : 'title');
					const source = field === 'qa' ? (l.qa || []).map(item => `${item.q} — ${item.a}`).join(' · ') : String(l[field] || '');
					return {
						...lectureSummaryToClient(l),
						courseTitle: titles.get(l.courseId) || '',
						field,
						snippet: field === 'title' ? '' : snippetAround(source, q),
					};
				}),
		};
	}

	/* ─── roadmaps ─── */

	private roadmapStats(data: NormalizedRoadmap, progress: Record<string, string>) {
		const keys = roadmapTopicKeys(data);
		return {
			levels: data.levels?.length || 0,
			courses: (data.levels || []).reduce((n, l) => n + (l.courses?.length || 0), 0),
			topics: keys.length,
			done: keys.filter(k => progress?.[k]).length,
		};
	}

	private roadmapSummary(row: LearnRoadmap) {
		const data = row.data as NormalizedRoadmap;
		return {
			id: row.id,
			title: row.title,
			description: data.description || '',
			language: data.language || '',
			targetRole: data.target_role || [],
			updatedAt: ms(row.updated_at) ?? Date.now(),
			...this.roadmapStats(data, row.progress || {}),
		};
	}

	private async ownRoadmap(userId: string, id: string) {
		const row = await this.roadmaps.findOne({ where: { id, userId } });
		if (!row) throw new NotFoundException('Roadmap not found');
		return row;
	}

	async listRoadmaps(userId: string) {
		await this.ensureSchema();
		const rows = await this.roadmaps.find({ where: { userId }, order: { orderIndex: 'ASC', created_at: 'ASC' } });
		return { roadmaps: rows.map(row => this.roadmapSummary(row)) };
	}

	async getRoadmap(userId: string, id: string) {
		const row = await this.ownRoadmap(userId, id);
		return { ...this.roadmapSummary(row), data: row.data, progress: row.progress || {} };
	}

	async createRoadmap(userId: string, json: string) {
		await this.ensureSchema();
		const data = parseRoadmapJson(json);
		const max = await this.roadmaps
			.createQueryBuilder('r')
			.select('COALESCE(MAX(r.orderIndex), -1)', 'max')
			.where('r.userId = :userId', { userId })
			.getRawOne<{ max: string }>();
		const row = await this.roadmaps.save(
			this.roadmaps.create({ userId, title: data.title.slice(0, LEARN_MAX_TITLE), data, progress: {}, orderIndex: Number(max?.max ?? -1) + 1 }),
		);
		return this.getRoadmap(userId, row.id);
	}

	/** Replaces the roadmap's content; progress is kept for every topic that still exists. */
	async updateRoadmap(userId: string, id: string, json: string) {
		const row = await this.ownRoadmap(userId, id);
		const data = parseRoadmapJson(json);
		const keep = new Set(roadmapTopicKeys(data));
		const progress = Object.fromEntries(Object.entries(row.progress || {}).filter(([key]) => keep.has(key)));
		await this.roadmaps.update({ id, userId }, { title: data.title.slice(0, LEARN_MAX_TITLE), data: data as Record<string, any>, progress });
		return this.getRoadmap(userId, id);
	}

	/** Adds a topics index to a roadmap (explanations, missing topics, added courses); progress is untouched. */
	async importTopicsIndex(userId: string, id: string, json: string) {
		const row = await this.ownRoadmap(userId, id);
		const data = mergeTopicsIndex(row.data as NormalizedRoadmap, parseTopicsIndexJson(json));
		await this.roadmaps.update({ id, userId }, { data: data as Record<string, any> });
		return this.getRoadmap(userId, id);
	}

	async removeRoadmap(userId: string, id: string) {
		await this.ownRoadmap(userId, id);
		await this.roadmaps.softDelete({ id, userId });
		return { id };
	}

	/**
	 * Marks topics done / not done in one statement on the stored map, so two quick clicks (or two
	 * tabs) never overwrite each other's progress. Unknown keys are ignored.
	 */
	async setRoadmapTopics(userId: string, id: string, keys: string[], done: boolean) {
		const row = await this.ownRoadmap(userId, id);
		const valid = new Set(roadmapTopicKeys(row.data as NormalizedRoadmap));
		const wanted = [...new Set(keys)].filter(key => valid.has(key));
		if (!wanted.length) return { progress: row.progress || {} };
		const stamp = new Date().toISOString();
		const sql = done
			? `UPDATE learn_roadmaps SET progress = progress || COALESCE((SELECT jsonb_object_agg(k, $3::text) FROM unnest($4::text[]) AS k WHERE NOT (progress ? k)), '{}'::jsonb), updated_at = now()
				 WHERE id = $1 AND "userId" = $2 AND deleted_at IS NULL RETURNING progress`
			: `UPDATE learn_roadmaps SET progress = progress - $4::text[], updated_at = now()
				 WHERE id = $1 AND "userId" = $2 AND deleted_at IS NULL RETURNING progress`;
		const params = done ? [id, userId, stamp, wanted] : [id, userId, wanted];
		const result = await this.dataSource.query(done ? sql : sql.replace('$4', '$3'), params);
		const rows = Array.isArray(result?.[0]) ? result[0] : result;
		return { progress: rows?.[0]?.progress ?? {} };
	}

	private async touchCourse(userId: string, courseId: string) {
		await this.courses.update({ id: courseId, userId }, { lastStudiedAt: new Date() });
	}
}
