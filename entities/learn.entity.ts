import { Column, Entity, Index } from 'typeorm';
import { CoreEntity } from './global.entity';

export const LEARN_MAX_TITLE = 160;
export const LEARN_MAX_DESCRIPTION = 2000;
export const LEARN_MAX_CATEGORY = 60;
/** Lecture body and the text sections (HTML or Markdown from the Documents editor). */
export const LEARN_MAX_CONTENT = 2_000_000;
export const LEARN_MAX_SECTION = 200_000;
export const LEARN_MAX_QA = 200;
export const LEARN_MAX_QA_TEXT = 4000;
export const LEARN_COLORS = ['green', 'blue', 'violet', 'amber', 'rose', 'teal', 'slate'] as const;

/** One review card inside a lecture. */
export type LearnQaItem = { id: string; q: string; a: string };

/**
 * A course in the personal "Learn" library (WhatsApp page). Owned by one user; lectures live
 * in learn_lectures and are counted for its progress.
 */
@Entity('learn_courses')
@Index(['userId', 'orderIndex'])
export class LearnCourse extends CoreEntity {
	@Column({ type: 'uuid' })
	userId!: string;

	@Column({ type: 'varchar', length: LEARN_MAX_TITLE })
	title!: string;

	@Column({ type: 'text', default: '' })
	description!: string;

	@Column({ type: 'varchar', length: LEARN_MAX_CATEGORY, default: '' })
	category!: string;

	@Column({ type: 'varchar', length: 16, default: 'green' })
	color!: (typeof LEARN_COLORS)[number];

	@Column({ type: 'boolean', default: false })
	pinned!: boolean;

	@Column({ type: 'int', default: 0 })
	orderIndex!: number;

	/** When a lecture of this course was last opened or edited (for "continue learning"). */
	@Column({ type: 'timestamptz', nullable: true })
	lastStudiedAt!: Date | null;
}

/**
 * A lecture inside a course: the full content (same editor as Documents) plus the study
 * sections — personal notes, key points, summary, Q&A cards — and its done / revision state.
 */
@Entity('learn_lectures')
@Index(['userId', 'courseId', 'orderIndex'])
export class LearnLecture extends CoreEntity {
	@Column({ type: 'uuid' })
	userId!: string;

	@Column({ type: 'uuid' })
	courseId!: string;

	@Column({ type: 'varchar', length: LEARN_MAX_TITLE })
	title!: string;

	@Column({ type: 'text', default: '' })
	description!: string;

	@Column({ type: 'text', default: '' })
	content!: string;

	@Column({ type: 'text', default: '' })
	notes!: string;

	@Column({ type: 'text', default: '' })
	keyPoints!: string;

	@Column({ type: 'text', default: '' })
	summary!: string;

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	qa!: LearnQaItem[];

	@Column({ type: 'boolean', default: false })
	done!: boolean;

	@Column({ type: 'timestamptz', nullable: true })
	doneAt!: Date | null;

	@Column({ type: 'boolean', default: false })
	needsRevision!: boolean;

	@Column({ type: 'int', default: 0 })
	orderIndex!: number;
}

/** Largest roadmap JSON accepted (characters). */
export const LEARN_ROADMAP_MAX_JSON = 1_000_000;

/**
 * A learning roadmap imported from JSON (levels → courses → topics, plus schedule, timeline,
 * certifications, labs…). `data` is the normalized roadmap; `progress` maps a topic key
 * ("<courseId>::<topic>") to the time it was marked done, and is updated one key at a time.
 */
@Entity('learn_roadmaps')
@Index(['userId', 'orderIndex'])
export class LearnRoadmap extends CoreEntity {
	@Column({ type: 'uuid' })
	userId!: string;

	@Column({ type: 'varchar', length: LEARN_MAX_TITLE })
	title!: string;

	@Column({ type: 'jsonb' })
	data!: Record<string, any>;

	@Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
	progress!: Record<string, string>;

	@Column({ type: 'int', default: 0 })
	orderIndex!: number;
}
