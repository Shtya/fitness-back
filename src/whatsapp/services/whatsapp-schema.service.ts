import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// Safety net for already-deployed databases. New WhatsApp schema belongs in
// `backend/migrations/` (see 20260817_whatsapp_account_sync_watermarks.sql).
const OPTIONAL_TABLES = [
	`CREATE TABLE IF NOT EXISTS whatsapp_conversation_preferences (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at timestamptz NOT NULL DEFAULT now(),
		updated_at timestamptz NOT NULL DEFAULT now(),
		deleted_at timestamptz,
		conversation_id uuid REFERENCES whatsapp_conversations(id) ON DELETE SET NULL,
		account_id uuid REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
		provider_chat_id varchar(160),
		user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		is_favorite boolean NOT NULL DEFAULT false,
		is_pinned boolean NOT NULL DEFAULT false,
		is_archived boolean NOT NULL DEFAULT false
	)`,
	`ALTER TABLE whatsapp_conversation_preferences ADD COLUMN IF NOT EXISTS account_id uuid`,
	`ALTER TABLE whatsapp_conversation_preferences ADD COLUMN IF NOT EXISTS provider_chat_id varchar(160)`,
	`ALTER TABLE whatsapp_conversation_preferences ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false`,
	`ALTER TABLE whatsapp_conversation_preferences ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false`,
	`CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_preferences_identity
		ON whatsapp_conversation_preferences (account_id, provider_chat_id)`,
	`CREATE TABLE IF NOT EXISTS whatsapp_voice_changer_credentials (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at timestamptz NOT NULL DEFAULT now(),
		updated_at timestamptz NOT NULL DEFAULT now(),
		deleted_at timestamptz,
		user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		provider varchar(32) NOT NULL,
		encrypted_api_key text NOT NULL,
		key_last_four varchar(8) NOT NULL,
		CONSTRAINT uq_wa_voice_changer_user_provider UNIQUE (user_id, provider)
	)`,
	`CREATE TABLE IF NOT EXISTS whatsapp_saved_stickers (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at timestamptz NOT NULL DEFAULT now(),
		updated_at timestamptz NOT NULL DEFAULT now(),
		deleted_at timestamptz,
		account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
		user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		file_hash varchar(64) NOT NULL,
		mime_type varchar(160) NOT NULL,
		file_name varchar(300),
		storage_path varchar(1024) NOT NULL,
		source varchar(20) NOT NULL DEFAULT 'upload',
		is_animated boolean NOT NULL DEFAULT false,
		CONSTRAINT uq_whatsapp_saved_sticker_hash UNIQUE (account_id, file_hash)
	)`,
	`CREATE TABLE IF NOT EXISTS whatsapp_voice_changer_settings (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at timestamptz NOT NULL DEFAULT now(),
		updated_at timestamptz NOT NULL DEFAULT now(),
		deleted_at timestamptz,
		user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		configured boolean NOT NULL DEFAULT false,
		enabled boolean NOT NULL DEFAULT false,
		provider varchar(32) NOT NULL DEFAULT 'off',
		preset varchar(40) NOT NULL DEFAULT 'deeper',
		pitch_semitones int NOT NULL DEFAULT -5,
		voice_id varchar(120),
		CONSTRAINT uq_whatsapp_voice_changer_settings_user UNIQUE (user_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_whatsapp_saved_stickers_account ON whatsapp_saved_stickers(account_id)`,
	`CREATE INDEX IF NOT EXISTS idx_whatsapp_saved_stickers_user ON whatsapp_saved_stickers(user_id)`,
	`ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS initial_hydrated_at timestamptz`,
	`ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS last_history_sync_at timestamptz`,
	`CREATE TABLE IF NOT EXISTS whatsapp_chat_message_groups (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at timestamptz NOT NULL DEFAULT now(),
		updated_at timestamptz NOT NULL DEFAULT now(),
		deleted_at timestamptz,
		conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
		user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		name varchar(120) NOT NULL
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_chat_message_groups_name
		ON whatsapp_chat_message_groups (conversation_id, user_id, lower(name))
		WHERE deleted_at IS NULL`,
	`CREATE INDEX IF NOT EXISTS idx_whatsapp_chat_message_groups_conversation
		ON whatsapp_chat_message_groups(conversation_id)`,
	`CREATE INDEX IF NOT EXISTS idx_whatsapp_chat_message_groups_user
		ON whatsapp_chat_message_groups(user_id)`,
	`CREATE TABLE IF NOT EXISTS whatsapp_chat_message_group_items (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at timestamptz NOT NULL DEFAULT now(),
		updated_at timestamptz NOT NULL DEFAULT now(),
		deleted_at timestamptz,
		group_id uuid NOT NULL REFERENCES whatsapp_chat_message_groups(id) ON DELETE CASCADE,
		conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
		message_id uuid NOT NULL REFERENCES whatsapp_messages(id) ON DELETE CASCADE,
		user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_chat_message_group_item_message
		ON whatsapp_chat_message_group_items (message_id, user_id)
		WHERE deleted_at IS NULL`,
	`CREATE INDEX IF NOT EXISTS idx_whatsapp_chat_message_group_items_group
		ON whatsapp_chat_message_group_items(group_id)`,
	`CREATE INDEX IF NOT EXISTS idx_whatsapp_chat_message_group_items_conversation
		ON whatsapp_chat_message_group_items(conversation_id)`,
];

@Injectable()
export class WhatsAppSchemaService implements OnModuleInit {
	private readonly logger = new Logger(WhatsAppSchemaService.name);

	constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

	async onModuleInit() {
		for (const statement of OPTIONAL_TABLES) {
			try {
				await this.dataSource.query(statement);
			} catch (error) {
				this.logger.error(
					`Could not ensure WhatsApp table: ${error instanceof Error ? error.message : error}`,
				);
			}
		}
	}
}
