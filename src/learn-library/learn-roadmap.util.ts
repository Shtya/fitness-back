import { BadRequestException } from '@nestjs/common';

/*
 * Learning roadmaps arrive as JSON written by hand or by an AI (levels → courses → topics, plus
 * a schedule, timeline, certifications, labs and lab setup). Only the known fields are kept,
 * every string is trimmed and capped, links must be http(s), and each course gets a unique id,
 * so a topic's progress key ("<courseId>::<topic>") stays stable across edits.
 */

const LIMITS = { title: 160, text: 2000, short: 120, url: 1000, list: 300 };

type Obj = Record<string, unknown>;

export type RoadmapCourse = {
	id: string;
	title: string;
	title_ar: string;
	url: string | null;
	language: string;
	level: string;
	topics: string[];
	/** topic → why it matters later (from a topics index or topics_detailed) */
	topic_benefits: Record<string, string>;
	/** added to the roadmap by a topics index (a course the original roadmap did not have) */
	added_by_index: boolean;
	expected_outcome: string;
	practical_result: string;
};

export type RoadmapLevel = {
	id: string;
	title: string;
	title_ar: string;
	description: string;
	priority: string;
	courses: RoadmapCourse[];
};

export type NormalizedRoadmap = {
	title: string;
	description: string;
	language: string;
	target_role: string[];
	learning_policy: Record<string, boolean>;
	/** the topics index note (what the per-topic explanations are for) */
	topics_index_note: string;
	levels: RoadmapLevel[];
	recommended_study_schedule: { daily_hours: number | null; study_distribution: { activity: string; activity_ar: string; hours: number | null }[] } | null;
	recommended_timeline: { period: string; focus: string }[];
	certifications: { name: string; level: string; url: string | null; purpose: string }[];
	recommended_labs: { name: string; url: string | null; purpose: string }[];
	lab_environment: {
		recommended_ram_gb: number | null;
		preferred_ram_gb: number | null;
		recommended_storage_gb: number | null;
		software: { name: string; url: string | null }[];
	} | null;
};

const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = LIMITS.text) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e6 ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, LIMITS.list) : []);
const slug = (v: string) => v.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

export function safeUrl(v: unknown): string | null {
	const raw = str(v, LIMITS.url);
	if (!raw) return null;
	try {
		const url = new URL(raw);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
	} catch {
		return null;
	}
}

const fail = (path: string, message: string): never => {
	throw new BadRequestException(`${path}: ${message}`);
};

/** The key a topic's progress is stored under. */
export const topicKey = (courseId: string, topic: string) => `${courseId}::${topic}`;

export function normalizeRoadmap(input: unknown): NormalizedRoadmap {
	const root = isObj(input) && isObj(input.roadmap) ? input.roadmap : input;
	if (!isObj(root)) fail('roadmap', 'expected a JSON object');
	const r = root as Obj;

	const title = str(r.title, LIMITS.title);
	if (!title) fail('roadmap.title', 'is required');

	const rawLevels = arr(r.levels);
	if (!rawLevels.length) fail('roadmap.levels', 'needs at least one level');

	const usedLevelIds = new Set<string>();
	const usedCourseIds = new Set<string>();
	const unique = (used: Set<string>, wanted: string) => {
		let id = wanted;
		for (let n = 2; used.has(id); n += 1) id = `${wanted}_${n}`;
		used.add(id);
		return id;
	};

	const levels = rawLevels.map((rawLevel, li): RoadmapLevel => {
		const path = `roadmap.levels[${li}]`;
		if (!isObj(rawLevel)) return fail(path, 'expected an object');
		const levelTitle = str(rawLevel.title, LIMITS.title) || str(rawLevel.title_ar, LIMITS.title);
		if (!levelTitle) fail(`${path}.title`, 'is required');
		const levelId = unique(usedLevelIds, slug(str(rawLevel.id, 60)) || `level_${li + 1}`);
		const courses = arr(rawLevel.courses).map((rawCourse, ci): RoadmapCourse => {
			const cpath = `${path}.courses[${ci}]`;
			if (!isObj(rawCourse)) return fail(cpath, 'expected an object');
			const courseTitle = str(rawCourse.title, LIMITS.title) || str(rawCourse.title_ar, LIMITS.title);
			if (!courseTitle) fail(`${cpath}.title`, 'is required');
			// Topics come as plain names, as { topic, benefit_ar } objects (topics_detailed), or both;
			// a topic_benefits map (what this normalizer writes) is read back too.
			const seen = new Set<string>();
			const topics: string[] = [];
			const benefits: Record<string, string> = {};
			for (const raw of [...arr(rawCourse.topics), ...arr(rawCourse.topics_detailed)]) {
				const name = isObj(raw) ? str(raw.topic ?? raw.name ?? raw.title, LIMITS.title) : str(raw, LIMITS.title);
				if (!name) continue;
				const benefit = isObj(raw) ? str(raw.benefit_ar ?? raw.benefit ?? raw.description) : '';
				const known = topics.find(t => t.toLowerCase() === name.toLowerCase());
				if (!known && !seen.has(name.toLowerCase())) {
					seen.add(name.toLowerCase());
					topics.push(name);
				}
				if (benefit && !benefits[known || name]) benefits[known || name] = benefit;
			}
			if (isObj(rawCourse.topic_benefits)) {
				for (const [name, value] of Object.entries(rawCourse.topic_benefits)) {
					const known = topics.find(t => t.toLowerCase() === name.trim().toLowerCase());
					const benefit = str(value);
					if (known && benefit && !benefits[known]) benefits[known] = benefit;
				}
			}
			return {
				id: unique(usedCourseIds, slug(str(rawCourse.id, 60)) || `${levelId}_course_${ci + 1}`),
				title: courseTitle,
				title_ar: str(rawCourse.title_ar, LIMITS.title),
				url: safeUrl(rawCourse.youtube_search_url ?? rawCourse.url ?? rawCourse.link),
				language: str(rawCourse.language, 12),
				level: str(rawCourse.level, 40),
				topics,
				topic_benefits: benefits,
				added_by_index: rawCourse.added_by_index === true,
				expected_outcome: str(rawCourse.expected_outcome),
				practical_result: str(rawCourse.practical_result),
			};
		});
		return {
			id: levelId,
			title: levelTitle,
			title_ar: str(rawLevel.title_ar, LIMITS.title),
			description: str(rawLevel.description),
			priority: str(rawLevel.priority, 40),
			courses,
		};
	});

	if (!levels.some(l => l.courses.some(c => c.topics.length))) fail('roadmap.levels', 'no course has any topics');

	const policy: Record<string, boolean> = {};
	if (isObj(r.learning_policy)) {
		for (const [key, value] of Object.entries(r.learning_policy).slice(0, 20)) {
			if (typeof value === 'boolean') policy[slug(key)] = value;
		}
	}

	const schedule = isObj(r.recommended_study_schedule)
		? {
				daily_hours: num(r.recommended_study_schedule.daily_hours),
				study_distribution: arr(r.recommended_study_schedule.study_distribution)
					.filter(isObj)
					.map(item => ({ activity: str(item.activity, LIMITS.short), activity_ar: str(item.activity_ar, LIMITS.short), hours: num(item.hours) }))
					.filter(item => item.activity || item.activity_ar),
			}
		: null;

	const lab = isObj(r.lab_environment)
		? {
				recommended_ram_gb: num(r.lab_environment.recommended_ram_gb),
				preferred_ram_gb: num(r.lab_environment.preferred_ram_gb),
				recommended_storage_gb: num(r.lab_environment.recommended_storage_gb),
				software: arr(r.lab_environment.software)
					.filter(isObj)
					.map(item => ({ name: str(item.name, LIMITS.short), url: safeUrl(item.url) }))
					.filter(item => item.name),
			}
		: null;

	return {
		title,
		description: str(r.description),
		language: str(r.language, 12),
		target_role: arr(r.target_role).map(v => str(v, LIMITS.short)).filter(Boolean),
		learning_policy: policy,
		topics_index_note: str(r.topics_index_note),
		levels,
		recommended_study_schedule: schedule,
		recommended_timeline: arr(r.recommended_timeline)
			.filter(isObj)
			.map(item => ({ period: str(item.period, LIMITS.short), focus: str(item.focus) }))
			.filter(item => item.period || item.focus),
		certifications: arr(r.certifications)
			.filter(isObj)
			.map(item => ({ name: str(item.name, LIMITS.short), level: str(item.level, 40), url: safeUrl(item.url), purpose: str(item.purpose) }))
			.filter(item => item.name),
		recommended_labs: arr(r.recommended_labs)
			.filter(isObj)
			.map(item => ({ name: str(item.name, LIMITS.short), url: safeUrl(item.url), purpose: str(item.purpose) }))
			.filter(item => item.name),
		lab_environment: lab,
	};
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(String(text || ''));
	} catch (error) {
		throw new BadRequestException(`Invalid JSON: ${error instanceof Error ? error.message : 'could not parse'}`);
	}
}

/** The topics index inside a parsed file ("roadmap_topics_index", or the bare index object), else null. */
function indexRoot(input: unknown): Obj | null {
	if (!isObj(input)) return null;
	if (isObj(input.roadmap_topics_index)) return input.roadmap_topics_index;
	const looksLikeIndex = arr(input.levels).some(
		l => isObj(l) && (l.level_id !== undefined || arr(l.courses).some(c => isObj(c) && c.course_id !== undefined)),
	);
	return looksLikeIndex && !isObj(input.roadmap) ? input : null;
}

/**
 * Parses pasted roadmap text; JSON errors become a readable 400. A file with both "roadmap" and
 * "roadmap_topics_index" is merged on the way in; an index on its own needs a roadmap to go into.
 */
export function parseRoadmapJson(text: string): NormalizedRoadmap {
	const parsed = parseJson(text);
	const index = indexRoot(parsed);
	if (index && !(isObj(parsed) && isObj(parsed.roadmap))) {
		throw new BadRequestException('roadmap_topics_index: this is a topics index; open a roadmap and use "Import topics index" to add it');
	}
	const data = normalizeRoadmap(parsed);
	return index ? mergeTopicsIndex(data, index) : data;
}

/** Parses a topics index file ("roadmap_topics_index" or its inner object). */
export function parseTopicsIndexJson(text: string): Obj {
	const index = indexRoot(parseJson(text));
	if (!index) throw new BadRequestException('roadmap_topics_index: expected { "roadmap_topics_index": { "levels": [ … ] } }');
	if (!arr(index.levels).length) fail('roadmap_topics_index.levels', 'needs at least one level');
	return index;
}

/**
 * Merges a topics index into a roadmap: every listed topic gets its explanation (topics a course
 * did not have are added), courses the roadmap did not have are inserted into their level right
 * after the course they extend (course_05b after course_05) and marked added_by_index, and the
 * index note is kept. Existing topics keep their names, so progress keys never change.
 */
export function mergeTopicsIndex(data: NormalizedRoadmap, input: unknown): NormalizedRoadmap {
	const index = indexRoot(input) || (isObj(input) ? input : null);
	if (!index) return fail('roadmap_topics_index', 'expected an object');
	const levels: Obj[] = JSON.parse(JSON.stringify(data.levels));
	const findCourse = (id: string): Obj | null => {
		for (const level of levels) {
			const course = (level.courses as Obj[]).find(c => c.id === id);
			if (course) return course;
		}
		return null;
	};

	arr(index.levels).forEach((rawLevel, li) => {
		if (!isObj(rawLevel)) return;
		const levelId = slug(str(rawLevel.level_id ?? rawLevel.id, 60));
		let level = levels.find(l => l.id === levelId);
		if (!level) {
			const n = levels.length + 1;
			level = {
				id: levelId || `level_${n}`,
				title: str(rawLevel.title ?? rawLevel.title_ar, LIMITS.title) || levelId || `Level ${n}`,
				title_ar: str(rawLevel.title_ar, LIMITS.title),
				description: '',
				priority: '',
				courses: [],
			};
			levels.push(level);
		}
		arr(rawLevel.courses).forEach((rawCourse, ci) => {
			if (!isObj(rawCourse)) return;
			const courseId = slug(str(rawCourse.course_id ?? rawCourse.id, 60));
			if (!courseId) fail(`roadmap_topics_index.levels[${li}].courses[${ci}].course_id`, 'is required');
			const detailed = arr(rawCourse.topics_detailed ?? rawCourse.topics);
			const existing = findCourse(courseId);
			if (existing) {
				existing.topics_detailed = detailed;
				if (!existing.title_ar && str(rawCourse.title_ar)) existing.title_ar = str(rawCourse.title_ar, LIMITS.title);
				return;
			}
			const course: Obj = {
				id: courseId,
				title: str(rawCourse.title ?? rawCourse.title_ar, LIMITS.title) || courseId,
				title_ar: str(rawCourse.title_ar, LIMITS.title),
				url: rawCourse.youtube_search_url ?? rawCourse.url ?? null,
				level: str(rawCourse.level, 40),
				topics: [],
				topics_detailed: detailed,
				expected_outcome: str(rawCourse.expected_outcome),
				practical_result: str(rawCourse.practical_result),
				added_by_index: true,
			};
			const courses = level.courses as Obj[];
			// right after the course it extends: course_05b → after course_05 (and after any 05a)
			const base = courseId.replace(/[a-z]+$/i, '');
			let at = courses.length;
			for (let i = courses.length - 1; i >= 0; i -= 1) {
				const id = String(courses[i].id);
				if (id === base || (id.startsWith(base) && /^[a-z]+$/i.test(id.slice(base.length)) && id < courseId)) {
					at = i + 1;
					break;
				}
			}
			courses.splice(at, 0, course);
		});
	});

	return normalizeRoadmap({
		roadmap: {
			...data,
			topics_index_note: str(index.note_ar ?? index.note) || data.topics_index_note,
			levels,
		},
	});
}

/** Every topic key in the roadmap (for counting and for validating progress updates). */
export function roadmapTopicKeys(data: NormalizedRoadmap): string[] {
	const keys: string[] = [];
	for (const level of data.levels || []) for (const course of level.courses || []) for (const topic of course.topics || []) keys.push(topicKey(course.id, topic));
	return keys;
}
