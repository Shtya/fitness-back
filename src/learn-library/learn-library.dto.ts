import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { COURSE_KINDS } from './learn-english.util';
import {
	LEARN_COLORS,
	LEARN_MAX_CATEGORY,
	LEARN_MAX_CONTENT,
	LEARN_MAX_DESCRIPTION,
	LEARN_MAX_QA,
	LEARN_MAX_QA_TEXT,
	LEARN_MAX_SECTION,
	LEARN_MAX_TITLE,
	LEARN_ROADMAP_MAX_JSON,
} from 'entities/learn.entity';

/** The frontend's axios adds ?lang= to every request. */
export class LearnQuery {
	@IsOptional()
	@IsString()
	lang?: string;
}

export class LearnSearchQuery extends LearnQuery {
	@IsString()
	@MaxLength(120)
	q!: string;
}

class CourseFields {
	@IsOptional()
	@IsString()
	@MaxLength(LEARN_MAX_DESCRIPTION)
	description?: string;

	@IsOptional()
	@IsString()
	@MaxLength(LEARN_MAX_CATEGORY)
	category?: string;

	@IsOptional()
	@IsIn(LEARN_COLORS as unknown as string[])
	color?: (typeof LEARN_COLORS)[number];

	@IsOptional()
	@IsBoolean()
	pinned?: boolean;

	@IsOptional()
	@IsIn(COURSE_KINDS as unknown as string[])
	kind?: (typeof COURSE_KINDS)[number];
}

export class CreateCourseDto extends CourseFields {
	@IsString()
	@MinLength(1)
	@MaxLength(LEARN_MAX_TITLE)
	title!: string;
}

export class UpdateCourseDto extends CourseFields {
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(LEARN_MAX_TITLE)
	title?: string;
}

export class LearnQaItemDto {
	@IsString()
	@MinLength(1)
	@MaxLength(40)
	id!: string;

	@IsString()
	@MaxLength(LEARN_MAX_QA_TEXT)
	q!: string;

	@IsString()
	@MaxLength(LEARN_MAX_QA_TEXT)
	a!: string;
}

class LectureFields {
	@IsOptional()
	@IsString()
	@MaxLength(LEARN_MAX_DESCRIPTION)
	description?: string;

	@IsOptional()
	@IsString()
	@MaxLength(LEARN_MAX_CONTENT)
	content?: string;

	@IsOptional()
	@IsString()
	@MaxLength(LEARN_MAX_SECTION)
	notes?: string;

	@IsOptional()
	@IsString()
	@MaxLength(LEARN_MAX_SECTION)
	keyPoints?: string;

	@IsOptional()
	@IsString()
	@MaxLength(LEARN_MAX_SECTION)
	summary?: string;

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(LEARN_MAX_QA)
	@ValidateNested({ each: true })
	@Type(() => LearnQaItemDto)
	qa?: LearnQaItemDto[];

	@IsOptional()
	@IsBoolean()
	done?: boolean;

	@IsOptional()
	@IsBoolean()
	needsRevision?: boolean;

	/** English day (cleaned and size-limited by the service). */
	@IsOptional()
	@IsObject()
	english?: Record<string, any>;
}

export class CreateLectureDto extends LectureFields {
	@IsString()
	@MinLength(1)
	@MaxLength(LEARN_MAX_TITLE)
	title!: string;
}

export class UpdateLectureDto extends LectureFields {
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(LEARN_MAX_TITLE)
	title?: string;
}

export class ReorderDto {
	@IsArray()
	@ArrayMaxSize(1000)
	@IsUUID('all', { each: true })
	ids!: string[];
}

export class EnglishAiDto {
	@IsIn(['questions', 'word', 'correct'])
	task!: 'questions' | 'word' | 'correct';

	/** For 'correct': what the learner said. */
	@IsOptional()
	@IsString()
	@MaxLength(8000)
	text?: string;

	@IsOptional()
	@IsString()
	@MaxLength(200)
	topic?: string;

	@IsOptional()
	@IsString()
	@MaxLength(6000)
	transcript?: string;

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(60)
	@IsString({ each: true })
	@MaxLength(120, { each: true })
	words?: string[];

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(40)
	@IsString({ each: true })
	@MaxLength(400, { each: true })
	existing?: string[];

	@IsOptional()
	@IsInt()
	@Min(3)
	@Max(10)
	count?: number;

	@IsOptional()
	@IsString()
	@MaxLength(120)
	word?: string;

	@IsOptional()
	@IsString()
	@MaxLength(600)
	context?: string;
}

export class RoadmapJsonDto {
	/** The roadmap JSON as text (parsed and validated on the server). */
	@IsString()
	@MinLength(2)
	@MaxLength(LEARN_ROADMAP_MAX_JSON)
	json!: string;
}

export class RoadmapTopicsDto {
	@IsArray()
	@ArrayMaxSize(1000)
	@IsString({ each: true })
	@MaxLength(400, { each: true })
	keys!: string[];

	@IsBoolean()
	done!: boolean;
}
