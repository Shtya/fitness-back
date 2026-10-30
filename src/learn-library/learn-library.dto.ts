import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import {
	LEARN_COLORS,
	LEARN_MAX_CATEGORY,
	LEARN_MAX_CONTENT,
	LEARN_MAX_DESCRIPTION,
	LEARN_MAX_QA,
	LEARN_MAX_QA_TEXT,
	LEARN_MAX_SECTION,
	LEARN_MAX_TITLE,
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
