import { Allow, IsBoolean, IsObject, IsOptional, IsString, IsIn, IsArray } from 'class-validator';

export class SaveConfigDto {
  @IsObject()
  config: Record<string, any>;
}

export class UpsertSecretsDto {
  @Allow()
  @IsObject()
  secrets: Record<string, Record<string, string>>;
}

export class TestModuleDto {
  @IsOptional() @IsString() provider?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() prompt?: string;
  @IsOptional() @IsString() topic?: string;
  @IsOptional() @IsString() aspectRatio?: string;
  @IsOptional() @IsString() resolution?: string;
  @IsOptional() @IsString() negativePrompt?: string;
  @IsOptional() @IsString() workflowJson?: string;
  @IsOptional() @IsString() pageId?: string;
  @IsOptional() @IsString() igUserId?: string;
  @IsOptional() @IsString() caption?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsArray() fallbackProviders?: string[];
  @IsOptional() @IsObject() custom?: Record<string, any>;
  /** When false, skip web research even if research is enabled in config. */
  @IsOptional() @IsBoolean() useResearch?: boolean;
  @IsOptional() @IsString() brief?: string;
  @IsOptional() @IsArray() sources?: string[];
  @IsOptional() maxResults?: number;
}

export class RunPipelineDto {
  @IsOptional() @IsBoolean() publish?: boolean;
  @IsOptional() @IsObject() publishTargets?: { facebook?: boolean; instagram?: boolean };
  @IsOptional() @IsBoolean() autoPublish?: boolean;
  @IsOptional() @IsObject() configOverride?: Record<string, any>;
  @IsOptional() @IsString() resumeFrom?: string;
  /** When true, returns immediately with RUNNING execution; client should poll history/:id */
  @IsOptional() @IsBoolean() async?: boolean;
  @IsOptional()
  @IsIn(['topic', 'content', 'image', 'design', 'facebook', 'instagram'])
  onlyModule?: 'topic' | 'content' | 'image' | 'design' | 'facebook' | 'instagram';
}

export class PublishDto {
  @IsString() executionId: string;
  @IsOptional() @IsBoolean() facebook?: boolean;
  @IsOptional() @IsBoolean() instagram?: boolean;
}
