import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryColumn,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';

@Entity('transcriptions')
@Index(['userId', 'createdAt'])
export class Transcription {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index()
	@Column({ type: 'uuid' })
	userId: string;

	@Column({ type: 'varchar', length: 255 })
	originalFileName: string;

	@Column({ type: 'varchar', length: 16, default: 'local' })
	provider: string;

	@Column({ type: 'text' })
	text: string;

	@Column({ type: 'varchar', length: 16, default: 'auto' })
	requestedLanguage: string;

	@Column({ type: 'varchar', length: 16, nullable: true })
	detectedLanguage: string | null;

	@Column({ type: 'text', nullable: true })
	customVocabulary: string | null;

	@Column({ type: 'double precision', default: 0 })
	durationSeconds: number;

	@Column({ type: 'double precision', default: 0 })
	processingTimeSeconds: number;

	@Column({ type: 'integer', default: 0 })
	wordCount: number;

	@Column({ type: 'integer', default: 0 })
	characterCount: number;

	@CreateDateColumn({ type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ type: 'timestamptz' })
	updatedAt: Date;
}

@Entity('transcription_provider_credentials')
export class TranscriptionProviderCredential {
	@PrimaryColumn({ type: 'varchar', length: 32 })
	provider: string;

	@Column({ type: 'text' })
	encryptedApiKey: string;

	@Column({ type: 'varchar', length: 8 })
	keyLastFour: string;

	@Column({ type: 'uuid', nullable: true })
	updatedBy: string | null;

	@CreateDateColumn({ type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ type: 'timestamptz' })
	updatedAt: Date;
}
