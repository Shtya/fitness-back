import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

/**
 * ProjectMind entities. Schema source of truth: backend/migrations/20261124_projectmind_init.sql
 * (this repo ships reviewed SQL migrations; TypeORM synchronize is off).
 */

@Entity('pm_projects')
export class PmProject {
	@PrimaryGeneratedColumn('uuid') id: string;
	@Index() @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId: string;
	@Column({ name: 'created_by', type: 'uuid' }) createdBy: string;
	@Column({ type: 'varchar', length: 160 }) name: string;
	@Column({ type: 'text', nullable: true }) description: string | null;
	@Column({ name: 'source_type', type: 'varchar', length: 16, default: 'zip' }) sourceType: 'zip' | 'github';
	@Column({ name: 'source_url', type: 'varchar', length: 500, nullable: true }) sourceUrl: string | null;
	@Column({ type: 'varchar', length: 200, nullable: true }) branch: string | null;
	@Column({ type: 'varchar', length: 16, default: 'draft' }) status: string;
	@Column({ name: 'status_message', type: 'text', nullable: true }) statusMessage: string | null;
	@Column({ type: 'int', default: 0 }) progress: number;
	@Column({ name: 'commit_sha', type: 'varchar', length: 64, nullable: true }) commitSha: string | null;
	@Column({ name: 'file_count', type: 'int', default: 0 }) fileCount: number;
	@Column({ name: 'chunk_count', type: 'int', default: 0 }) chunkCount: number;
	@Column({ name: 'total_bytes', type: 'bigint', default: 0, transformer: { to: (v: number) => v, from: (v: string) => Number(v) } }) totalBytes: number;
	@Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) languages: Record<string, number>;
	@Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) analysis: Record<string, any>;
	@Column({ name: 'analyzed_at', type: 'timestamptz', nullable: true }) analyzedAt: Date | null;
	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
	@DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt: Date | null;
}

@Entity('pm_files')
@Unique(['projectId', 'path'])
export class PmFile {
	@PrimaryGeneratedColumn('uuid') id: string;
	@Index() @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
	@ManyToOne(() => PmProject, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'project_id' }) project?: PmProject;
	@Column({ type: 'varchar', length: 1000 }) path: string;
	@Column({ type: 'varchar', length: 32, nullable: true }) language: string | null;
	@Column({ name: 'size_bytes', type: 'int', default: 0 }) sizeBytes: number;
	@Column({ name: 'line_count', type: 'int', default: 0 }) lineCount: number;
	@Column({ type: 'text', nullable: true }) content: string | null;
	@Column({ type: 'boolean', default: false }) excluded: boolean;
	@Column({ name: 'exclude_reason', type: 'varchar', length: 64, nullable: true }) excludeReason: string | null;
	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" }) symbols: Array<{ name: string; kind: string; line: number }>;
	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" }) imports: string[];
}

@Entity('pm_chunks')
export class PmChunk {
	@PrimaryGeneratedColumn('uuid') id: string;
	@Index() @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
	@Column({ name: 'file_id', type: 'uuid' }) fileId: string;
	@Column({ type: 'varchar', length: 1000 }) path: string;
	@Column({ name: 'start_line', type: 'int' }) startLine: number;
	@Column({ name: 'end_line', type: 'int' }) endLine: number;
	@Column({ type: 'text' }) text: string;
	@Column({ type: 'text', default: '' }) symbols: string;
	// `tsv` is a generated column managed by the migration; intentionally not mapped.
}

@Entity('pm_conversations')
export class PmConversation {
	@PrimaryGeneratedColumn('uuid') id: string;
	@Index() @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
	@Column({ name: 'workspace_id', type: 'uuid' }) workspaceId: string;
	@Column({ name: 'user_id', type: 'uuid' }) userId: string;
	@Column({ type: 'varchar', length: 200, default: 'New conversation' }) title: string;
	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('pm_messages')
export class PmMessage {
	@PrimaryGeneratedColumn('uuid') id: string;
	@Index() @Column({ name: 'conversation_id', type: 'uuid' }) conversationId: string;
	@Column({ type: 'varchar', length: 12 }) role: 'user' | 'assistant';
	@Column({ type: 'text' }) content: string;
	@Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) meta: Record<string, any>;
	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('pm_doc_sections')
@Unique(['projectId', 'key'])
export class PmDocSection {
	@PrimaryGeneratedColumn('uuid') id: string;
	@Column({ name: 'project_id', type: 'uuid' }) projectId: string;
	@Column({ type: 'varchar', length: 48 }) key: string;
	@Column({ type: 'varchar', length: 200 }) title: string;
	@Column({ name: 'content_md', type: 'text', default: '' }) contentMd: string;
	@Column({ type: 'varchar', length: 12, default: 'generated' }) origin: 'generated' | 'ai' | 'edited';
	@Column({ type: 'varchar', length: 12, default: 'verified' }) verification: 'verified' | 'inferred' | 'unverified';
	@Column({ name: 'commit_sha', type: 'varchar', length: 64, nullable: true }) commitSha: string | null;
	@Column({ name: 'generated_at', type: 'timestamptz', default: () => 'now()' }) generatedAt: Date;
	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('pm_knowledge_gaps')
@Unique(['projectId', 'dedupeKey'])
export class PmKnowledgeGap {
	@PrimaryGeneratedColumn('uuid') id: string;
	@Column({ name: 'project_id', type: 'uuid' }) projectId: string;
	@Column({ name: 'dedupe_key', type: 'varchar', length: 200 }) dedupeKey: string;
	@Column({ type: 'varchar', length: 300 }) title: string;
	@Column({ type: 'text', nullable: true }) description: string | null;
	@Column({ type: 'varchar', length: 10, default: 'medium' }) priority: string;
	@Column({ type: 'varchar', length: 14, default: 'not_started' }) status: string;
	@Column({ type: 'varchar', length: 10, default: 'auto' }) source: string;
	@Column({ name: 'related_files', type: 'jsonb', default: () => "'[]'::jsonb" }) relatedFiles: string[];
	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('pm_meetings')
export class PmMeeting {
	@PrimaryGeneratedColumn('uuid') id: string;
	@Column({ name: 'project_id', type: 'uuid' }) projectId: string;
	@Column({ name: 'workspace_id', type: 'uuid' }) workspaceId: string;
	@Column({ name: 'user_id', type: 'uuid' }) userId: string;
	@Column({ type: 'varchar', length: 200 }) title: string;
	@Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true }) scheduledAt: Date | null;
	@Column({ type: 'varchar', length: 12, default: 'planned' }) status: string;
	@Column({ name: 'recording_status', type: 'varchar', length: 12, default: 'none' }) recordingStatus: string;
	@Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) prep: Record<string, any>;
	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('pm_meeting_notes')
export class PmMeetingNote {
	@PrimaryGeneratedColumn('uuid') id: string;
	@Index() @Column({ name: 'meeting_id', type: 'uuid' }) meetingId: string;
	@Column({ type: 'varchar', length: 12 }) kind: string;
	@Column({ type: 'text' }) body: string;
	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('pm_sim_sessions')
export class PmSimSession {
	@PrimaryGeneratedColumn('uuid') id: string;
	@Column({ name: 'project_id', type: 'uuid' }) projectId: string;
	@Column({ name: 'workspace_id', type: 'uuid' }) workspaceId: string;
	@Column({ name: 'user_id', type: 'uuid' }) userId: string;
	@Column({ type: 'varchar', length: 24 }) scenario: string;
	@Column({ type: 'varchar', length: 10, default: 'medium' }) difficulty: string;
	@Column({ type: 'varchar', length: 12, default: 'active' }) status: string;
	@Column({ name: 'total_score', type: 'int', nullable: true }) totalScore: number | null;
	@Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) summary: Record<string, any>;
	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
	@Column({ name: 'completed_at', type: 'timestamptz', nullable: true }) completedAt: Date | null;
}

@Entity('pm_sim_turns')
@Unique(['sessionId', 'idx'])
export class PmSimTurn {
	@PrimaryGeneratedColumn('uuid') id: string;
	@Column({ name: 'session_id', type: 'uuid' }) sessionId: string;
	@Column({ type: 'int' }) idx: number;
	@Column({ type: 'text' }) question: string;
	@Column({ type: 'text', nullable: true }) answer: string | null;
	@Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) scores: Record<string, number>;
	@Column({ type: 'int', nullable: true }) total: number | null;
	@Column({ type: 'text', nullable: true }) feedback: string | null;
	@Column({ name: 'ideal_answer', type: 'text', nullable: true }) idealAnswer: string | null;
	@Column({ name: 'follow_up', type: 'text', nullable: true }) followUp: string | null;
}

@Entity('pm_audit_logs')
export class PmAuditLog {
	@PrimaryGeneratedColumn('uuid') id: string;
	@Column({ name: 'workspace_id', type: 'uuid' }) workspaceId: string;
	@Column({ name: 'user_id', type: 'uuid', nullable: true }) userId: string | null;
	@Column({ name: 'project_id', type: 'uuid', nullable: true }) projectId: string | null;
	@Column({ type: 'varchar', length: 48 }) action: string;
	@Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) meta: Record<string, any>;
	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

export const PM_ENTITIES = [PmProject, PmFile, PmChunk, PmConversation, PmMessage, PmDocSection, PmKnowledgeGap, PmMeeting, PmMeetingNote, PmSimSession, PmSimTurn, PmAuditLog];
