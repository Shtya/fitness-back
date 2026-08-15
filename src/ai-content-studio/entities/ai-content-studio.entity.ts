import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('ai_content_studio_secrets')
@Index(['userId'], { unique: true })
export class AiContentStudioSecretsEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** AES-GCM encrypted JSON of all provider/meta secrets */
  @Column({ name: 'encrypted_payload', type: 'text' })
  encryptedPayload: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('ai_content_studio_config')
@Index(['userId'], { unique: true })
export class AiContentStudioConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** Non-sensitive pipeline configuration JSON */
  @Column({ name: 'config_json', type: 'jsonb', default: {} })
  configJson: Record<string, any>;

  @Column({ name: 'automation_enabled', type: 'boolean', default: false })
  automationEnabled: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

export type PipelineStatus =
  | 'IDLE'
  | 'RUNNING'
  | 'TOPIC_GENERATED'
  | 'CONTENT_GENERATED'
  | 'IMAGE_GENERATED'
  | 'DESIGN_GENERATED'
  | 'FACEBOOK_PUBLISHED'
  | 'INSTAGRAM_PUBLISHED'
  | 'COMPLETED'
  | 'FAILED';

@Entity('ai_content_studio_executions')
@Index(['userId', 'createdAt'])
export class AiContentStudioExecutionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 32, default: 'IDLE' })
  status: PipelineStatus;

  @Column({ type: 'text', nullable: true })
  topic: string | null;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  @Column({ name: 'headline', type: 'text', nullable: true })
  headline: string | null;

  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl: string | null;

  @Column({ name: 'final_image_url', type: 'text', nullable: true })
  finalImageUrl: string | null;

  @Column({ name: 'public_image_url', type: 'text', nullable: true })
  publicImageUrl: string | null;

  @Column({ name: 'providers_json', type: 'jsonb', nullable: true })
  providersJson: Record<string, any> | null;

  @Column({ name: 'models_json', type: 'jsonb', nullable: true })
  modelsJson: Record<string, any> | null;

  @Column({ name: 'facebook_status', type: 'varchar', length: 32, nullable: true })
  facebookStatus: string | null;

  @Column({ name: 'instagram_status', type: 'varchar', length: 32, nullable: true })
  instagramStatus: string | null;

  @Column({ name: 'facebook_post_id', type: 'varchar', length: 128, nullable: true })
  facebookPostId: string | null;

  @Column({ name: 'instagram_media_id', type: 'varchar', length: 128, nullable: true })
  instagramMediaId: string | null;

  @Column({ name: 'errors_json', type: 'jsonb', nullable: true })
  errorsJson: any[] | null;

  @Column({ name: 'logs_json', type: 'jsonb', nullable: true })
  logsJson: any[] | null;

  /** Public web research hits used to inspire the topic (Google/FB/IG/news search) */
  @Column({ name: 'research_json', type: 'jsonb', nullable: true })
  researchJson: Record<string, any> | null;

  /** Live run progress for UI (phase, percent, step list) */
  @Column({ name: 'progress_json', type: 'jsonb', nullable: true })
  progressJson: Record<string, any> | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ name: 'trigger', type: 'varchar', length: 32, default: 'manual' })
  trigger: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
