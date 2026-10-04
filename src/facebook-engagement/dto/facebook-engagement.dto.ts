import { Transform, Type } from 'class-transformer';
import {
	ArrayMaxSize,
	ArrayMinSize,
	IsArray,
	IsIn,
	IsInt,
	IsOptional,
	IsString,
	IsUUID,
	Max,
	MaxLength,
	Min,
	MinLength,
	ValidateNested,
} from 'class-validator';
import { FbCampaignStatus, FbCommentStatus } from '../entities/facebook-engagement.entity';

export const FB_MAX_COMMENTS_PER_CAMPAIGN = 200;
export const FB_MAX_COMMENT_LENGTH = 8000;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) => {
	if (typeof value !== 'string') return value;
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
};

/** The frontend axios client appends `lang` to every request. */
export class LocalizedQueryDto {
	@IsOptional()
	@IsIn(['en', 'ar'])
	lang?: string;
}

export class PaginationQueryDto extends LocalizedQueryDto {
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	page?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	limit?: number;
}

export class OAuthUrlQueryDto extends LocalizedQueryDto {
	@IsOptional()
	@IsIn(['en', 'ar'])
	locale?: string;

	@IsOptional()
	@IsString()
	@MaxLength(256)
	returnOrigin?: string;

	@IsOptional()
	@IsIn(['0', '1', 'true', 'false'])
	popup?: string;
}

export class CompleteOAuthDto {
	@IsString()
	@MinLength(20)
	@MaxLength(4096)
	claim: string;
}

export class ConnectWithTokenDto {
	@Transform(trim)
	@IsString()
	@MinLength(20)
	@MaxLength(1024)
	accessToken: string;
}

export class PagePostsQueryDto extends LocalizedQueryDto {
	@IsOptional()
	@IsString()
	@MaxLength(512)
	after?: string;
}

export class ResolvePostDto {
	@IsUUID()
	accountId: string;

	@Transform(trim)
	@IsString()
	@MinLength(1)
	@MaxLength(2048)
	reference: string;
}

export class CampaignCommentInputDto {
	@Transform(trim)
	@IsString()
	@MinLength(1)
	@MaxLength(FB_MAX_COMMENT_LENGTH)
	message: string;

	@IsOptional()
	@IsUUID()
	accountId?: string;
}

export class CreateCampaignDto {
	@Transform(trim)
	@IsString()
	@MinLength(1)
	@MaxLength(160)
	name: string;

	@IsUUID()
	postId: string;

	@IsUUID()
	accountId: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(5)
	@Max(3600)
	pacingSeconds?: number;

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(FB_MAX_COMMENTS_PER_CAMPAIGN)
	@ValidateNested({ each: true })
	@Type(() => CampaignCommentInputDto)
	comments?: CampaignCommentInputDto[];
}

export class UpdateCampaignDto {
	@IsOptional()
	@Transform(trim)
	@IsString()
	@MinLength(1)
	@MaxLength(160)
	name?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(5)
	@Max(3600)
	pacingSeconds?: number;
}

export class ListCampaignsQueryDto extends PaginationQueryDto {
	@IsOptional()
	@IsIn(Object.values(FbCampaignStatus))
	status?: FbCampaignStatus;

	@IsOptional()
	@Transform(emptyToUndefined)
	@IsString()
	@MaxLength(160)
	search?: string;
}

export class PublishCampaignDto {
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(FB_MAX_COMMENTS_PER_CAMPAIGN)
	@IsUUID('all', { each: true })
	commentIds?: string[];
}

export class AddCommentDto extends CampaignCommentInputDto {}

export class BulkAddCommentsDto {
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(FB_MAX_COMMENTS_PER_CAMPAIGN)
	@IsString({ each: true })
	@MaxLength(FB_MAX_COMMENT_LENGTH, { each: true })
	messages: string[];

	@IsOptional()
	@IsUUID()
	accountId?: string;
}

export class UpdateCommentDto {
	@IsOptional()
	@Transform(trim)
	@IsString()
	@MinLength(1)
	@MaxLength(FB_MAX_COMMENT_LENGTH)
	message?: string;

	@IsOptional()
	@IsUUID()
	accountId?: string;
}

export class ReorderCommentsDto {
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(FB_MAX_COMMENTS_PER_CAMPAIGN)
	@IsUUID('all', { each: true })
	ids: string[];
}

export class BulkCommentIdsDto {
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(500)
	@IsUUID('all', { each: true })
	ids: string[];
}

export class BulkUpdateCommentsDto extends BulkCommentIdsDto {
	@IsOptional()
	@IsUUID()
	accountId?: string;

	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(500)
	find?: string;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	replace?: string;
}

export class ListCommentsQueryDto extends PaginationQueryDto {
	@IsOptional()
	@IsUUID()
	campaignId?: string;

	@IsOptional()
	@IsIn(Object.values(FbCommentStatus))
	status?: FbCommentStatus;

	@IsOptional()
	@IsUUID()
	accountId?: string;

	@IsOptional()
	@Transform(emptyToUndefined)
	@IsString()
	@MaxLength(200)
	search?: string;
}

export class ListActivityQueryDto extends PaginationQueryDto {
	@IsOptional()
	@IsUUID()
	campaignId?: string;

	@IsOptional()
	@IsIn(['info', 'success', 'warning', 'error'])
	level?: string;
}
