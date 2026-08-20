import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { AiModelPricing, AiModelType, AiUsageStatus } from '../ai.constants';

@Entity('ai_settings')
@Index('uq_ai_settings_workspace', ['workspaceId'], { unique: true })
export class AiSettingsEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index()
	@Column({ name: 'workspace_id', type: 'uuid' })
	workspaceId: string;

	@Column({ name: 'timezone', type: 'varchar', length: 80, default: 'Africa/Cairo' })
	timezone: string;

	@Column({ name: 'monthly_cost_limit', type: 'decimal', precision: 12, scale: 6, default: 20 })
	monthlyCostLimit: string;

	@Column({ name: 'monthly_request_limit', type: 'int', default: 1000 })
	monthlyRequestLimit: number;

	@Column({ name: 'monthly_image_limit', type: 'int', default: 100 })
	monthlyImageLimit: number;

	@Column({ name: 'safety_buffer_percent', type: 'decimal', precision: 5, scale: 2, default: 0 })
	safetyBufferPercent: string;

	@Column({ name: 'warnings_enabled', type: 'boolean', default: true })
	warningsEnabled: boolean;

	@Column({ name: 'feature_defaults', type: 'jsonb', default: {} })
	featureDefaults: Record<string, string>;

	@Column({ name: 'provider_limits', type: 'jsonb', default: {} })
	providerLimits: Record<string, { monthlyCostLimit?: number; monthlyRequestLimit?: number }>;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}

@Entity('ai_provider_credentials')
@Index('uq_ai_credentials_workspace_provider', ['workspaceId', 'provider'], { unique: true })
export class AiProviderCredentialEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index()
	@Column({ name: 'workspace_id', type: 'uuid' })
	workspaceId: string;

	@Column({ type: 'varchar', length: 40 })
	provider: string;

	@Column({ name: 'encrypted_api_key', type: 'text' })
	encryptedApiKey: string;

	@Column({ name: 'key_last4', type: 'varchar', length: 4, nullable: true })
	keyLast4: string | null;

	@Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
	verifiedAt: Date | null;

	@Column({ name: 'updated_by', type: 'uuid', nullable: true })
	updatedBy: string | null;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}

@Entity('ai_models')
@Index('uq_ai_models_workspace_key', ['workspaceId', 'modelKey'], { unique: true })
@Index('idx_ai_models_workspace_type_default', ['workspaceId', 'type', 'isDefault'])
export class AiModelEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index()
	@Column({ name: 'workspace_id', type: 'uuid' })
	workspaceId: string;

	@Column({ name: 'model_key', type: 'varchar', length: 120 })
	modelKey: string;

	@Column({ type: 'varchar', length: 160 })
	name: string;

	@Column({ type: 'varchar', length: 40 })
	provider: string;

	@Column({ type: 'varchar', length: 16 })
	type: AiModelType;

	@Column({ type: 'jsonb', default: {} })
	pricing: AiModelPricing;

	@Column({ type: 'boolean', default: true })
	enabled: boolean;

	@Column({ name: 'is_default', type: 'boolean', default: false })
	isDefault: boolean;

	@Column({ type: 'varchar', length: 24, default: 'custom' })
	tier: 'default' | 'premium' | 'custom';

	@Column({ type: 'boolean', default: false })
	system: boolean;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}

@Entity('ai_usage_periods')
@Index('uq_ai_usage_period', ['workspaceId', 'periodKey'], { unique: true })
export class AiUsagePeriodEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index()
	@Column({ name: 'workspace_id', type: 'uuid' })
	workspaceId: string;

	@Column({ name: 'period_key', type: 'varchar', length: 7 })
	periodKey: string;

	@Column({ name: 'request_count', type: 'int', default: 0 })
	requestCount: number;

	@Column({ name: 'image_count', type: 'int', default: 0 })
	imageCount: number;

	@Column({ name: 'estimated_cost', type: 'decimal', precision: 14, scale: 8, default: 0 })
	estimatedCost: string;

	@Column({ name: 'reserved_requests', type: 'int', default: 0 })
	reservedRequests: number;

	@Column({ name: 'reserved_images', type: 'int', default: 0 })
	reservedImages: number;

	@Column({ name: 'reserved_cost', type: 'decimal', precision: 14, scale: 8, default: 0 })
	reservedCost: string;

	@Column({ name: 'last_warning_level', type: 'int', nullable: true })
	lastWarningLevel: number | null;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}

@Entity('ai_usage_logs')
@Index('idx_ai_usage_workspace_created', ['workspaceId', 'createdAt'])
@Index('idx_ai_usage_workspace_model', ['workspaceId', 'modelKey'])
export class AiUsageLogEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index()
	@Column({ name: 'workspace_id', type: 'uuid' })
	workspaceId: string;

	@Index()
	@Column({ name: 'user_id', type: 'uuid', nullable: true })
	userId: string | null;

	@Column({ type: 'varchar', length: 80, nullable: true })
	feature: string | null;

	@Column({ type: 'varchar', length: 40 })
	provider: string;

	@Column({ name: 'model_key', type: 'varchar', length: 120 })
	modelKey: string;

	@Column({ type: 'varchar', length: 16 })
	type: AiModelType;

	@Column({ name: 'prompt_tokens', type: 'int', default: 0 })
	promptTokens: number;

	@Column({ name: 'completion_tokens', type: 'int', default: 0 })
	completionTokens: number;

	@Column({ name: 'total_tokens', type: 'int', default: 0 })
	totalTokens: number;

	@Column({ name: 'image_count', type: 'int', default: 0 })
	imageCount: number;

	@Column({ name: 'estimated_cost', type: 'decimal', precision: 14, scale: 8, default: 0 })
	estimatedCost: string;

	@Column({ type: 'varchar', length: 16, default: 'success' })
	status: AiUsageStatus;

	@Column({ name: 'error_code', type: 'varchar', length: 64, nullable: true })
	errorCode: string | null;

	@Column({ name: 'error_message', type: 'varchar', length: 400, nullable: true })
	errorMessage: string | null;

	@Column({ name: 'duration_ms', type: 'int', nullable: true })
	durationMs: number | null;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;
}

export const AI_ENTITIES = [
	AiSettingsEntity,
	AiProviderCredentialEntity,
	AiModelEntity,
	AiUsagePeriodEntity,
	AiUsageLogEntity,
];
