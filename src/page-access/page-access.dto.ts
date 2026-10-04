import { ArrayMaxSize, IsArray, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export const PAGE_ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
export const MAX_PAGE_IDS = 200;

export class UpdateRolePagesDto {
	@IsObject()
	modes: Record<string, string>;
}

export class UpdateUserPagesDto {
	@IsArray()
	@ArrayMaxSize(MAX_PAGE_IDS)
	@Matches(PAGE_ID_PATTERN, { each: true })
	extraPages: string[];

	@IsArray()
	@ArrayMaxSize(MAX_PAGE_IDS)
	@Matches(PAGE_ID_PATTERN, { each: true })
	lockedPages: string[];

	@IsOptional()
	@IsString()
	@MaxLength(80)
	loginLandingPage?: string | null;
}
