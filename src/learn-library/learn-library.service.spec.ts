import { readFileSync } from 'fs';
import { join } from 'path';
import { NotFoundException } from '@nestjs/common';
import { LEARN_SCHEMA_STATEMENTS } from './learn-library.schema';
import { LearnCourse, LearnLecture } from 'entities/learn.entity';
import { LearnLibraryService, lectureSummaryToClient, plainText, snippetAround } from './learn-library.service';

describe('learn-library text helpers', () => {
	it('plainText drops HTML and Markdown marks', () => {
		expect(plainText('<h1>OSI</h1><p>Layer <b>7</b> &amp; more</p>')).toBe('OSI Layer 7 & more');
		expect(plainText('## Title\n\n* **bold** item')).toBe('Title bold item');
	});

	it('snippetAround returns the text around the first match', () => {
		const text = `${'a '.repeat(80)}the TCP handshake has three steps${' b'.repeat(80)}`;
		const snippet = snippetAround(text, 'tcp', 10);
		expect(snippet).toContain('TCP');
		expect(snippet.startsWith('…')).toBe(true);
		expect(snippet.endsWith('…')).toBe(true);
		expect(snippetAround('nothing here', 'tcp')).toBe('');
	});

	it('lecture list rows leave the long text out', () => {
		const row = lectureSummaryToClient({
			id: 'l1',
			courseId: 'c1',
			title: 'Intro',
			description: '',
			content: '<p>long</p>',
			qa: [{ id: 'q', q: '?', a: '!' }],
			done: true,
			doneAt: new Date(1000),
			needsRevision: false,
			created_at: new Date(1),
			updated_at: new Date(2),
		} as unknown as LearnLecture);
		expect(row).not.toHaveProperty('content');
		expect(row.hasContent).toBe(true);
		expect(row.qaCount).toBe(1);
		expect(row.doneAt).toBe(1000);
	});
});

describe('Learn boot schema', () => {
	const migration = readFileSync(join(__dirname, '../../migrations/20261030_learn_library.sql'), 'utf8');
	const columnsOf = (sql: string, table: string) => {
		const body = sql.slice(sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`)).split(/\n\s*\);?|\)`/)[0];
		return [...body.matchAll(/^\s*("?\w+"?)\s+(uuid|timestamptz|varchar|text|boolean|integer|jsonb)/gm)].map(m => m[1]).sort();
	};

	it('only uses statements that are safe to run on every start', () => {
		for (const statement of LEARN_SCHEMA_STATEMENTS) {
			expect(statement).toMatch(/^(CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS)/);
			expect(statement).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i);
		}
	});

	it('creates the same tables and columns as the SQL migration', () => {
		const boot = LEARN_SCHEMA_STATEMENTS.join('\n');
		for (const table of ['learn_courses', 'learn_lectures']) {
			expect(columnsOf(boot, table)).toEqual(columnsOf(migration, table));
			expect(columnsOf(boot, table).length).toBeGreaterThan(10);
		}
	});

	it('runs once at boot and retries on the next load after a failure', async () => {
		const query = jest.fn().mockRejectedValueOnce(new Error('connection reset')).mockResolvedValue([]);
		const service = new LearnLibraryService({ find: jest.fn().mockResolvedValue([]) } as any, {} as any, {} as any, { query } as any);
		(service as any).statsFor = jest.fn().mockResolvedValue(new Map());
		jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

		expect(await service.onModuleInit()).toBe(false);
		await service.listCourses('u1');
		expect(query).toHaveBeenCalledTimes(1 + LEARN_SCHEMA_STATEMENTS.length);
		await service.listCourses('u1');
		expect(query).toHaveBeenCalledTimes(1 + LEARN_SCHEMA_STATEMENTS.length);
	});
});

describe('LearnLibraryService', () => {
	function createService() {
		const courses = {
			findOne: jest.fn(),
			update: jest.fn().mockResolvedValue(undefined),
		};
		const lectures = {
			findOne: jest.fn(),
			update: jest.fn().mockResolvedValue(undefined),
			softDelete: jest.fn().mockResolvedValue(undefined),
		};
		const service = new LearnLibraryService(courses as any, lectures as any, {} as any, {} as any);
		return { service, courses, lectures };
	}

	const lecture = (overrides: Partial<LearnLecture> = {}) =>
		({
			id: 'l1',
			userId: 'u1',
			courseId: 'c1',
			title: 'Intro',
			description: '',
			content: 'old body',
			notes: '',
			keyPoints: '',
			summary: '',
			qa: [],
			done: false,
			doneAt: null,
			needsRevision: false,
			orderIndex: 0,
			created_at: new Date(),
			updated_at: new Date(),
			...overrides,
		}) as LearnLecture;

	it('never reads another user’s lecture', async () => {
		const { service, lectures } = createService();
		lectures.findOne.mockResolvedValue(null);
		await expect(service.getLecture('u2', 'l1')).rejects.toBeInstanceOf(NotFoundException);
		expect(lectures.findOne).toHaveBeenCalledWith({ where: { id: 'l1', userId: 'u2' } });
	});

	it('updates only the fields that were sent', async () => {
		const { service, lectures } = createService();
		lectures.findOne.mockResolvedValueOnce(lecture()).mockResolvedValueOnce(lecture({ notes: 'mine' }));
		const result = await service.updateLecture('u1', 'l1', { notes: 'mine' });
		expect(lectures.update).toHaveBeenCalledWith({ id: 'l1', userId: 'u1' }, { notes: 'mine' });
		expect(result.content).toBe('old body');
	});

	it('stamps doneAt when a lecture is finished and clears it when reopened', async () => {
		const { service, lectures } = createService();
		lectures.findOne.mockResolvedValue(lecture());
		await service.updateLecture('u1', 'l1', { done: true });
		const patch = lectures.update.mock.calls[0][1];
		expect(patch.done).toBe(true);
		expect(patch.doneAt).toBeInstanceOf(Date);

		lectures.update.mockClear();
		lectures.findOne.mockResolvedValue(lecture({ done: true, doneAt: new Date() }));
		await service.updateLecture('u1', 'l1', { done: false });
		expect(lectures.update.mock.calls[0][1]).toEqual({ done: false, doneAt: null });
	});

	it('does not touch the course of another user when deleting', async () => {
		const { service, courses } = createService();
		courses.findOne.mockResolvedValue(null);
		await expect(service.removeCourse('u2', 'c1')).rejects.toBeInstanceOf(NotFoundException);
		expect(courses.findOne).toHaveBeenCalledWith({ where: { id: 'c1', userId: 'u2' } });
	});

	it('maps a course with its lecture counters', async () => {
		const { courseToClient } = await import('./learn-library.service');
		const out = courseToClient(
			{ id: 'c1', title: 'Net', description: '', category: 'IT', color: 'blue', pinned: false, lastStudiedAt: null, created_at: new Date(1), updated_at: new Date(2) } as unknown as LearnCourse,
			{ lectures: 10, done: 4, revision: 2 },
		);
		expect(out).toMatchObject({ id: 'c1', color: 'blue', lectures: 10, done: 4, revision: 2, lastStudiedAt: null });
	});
});
