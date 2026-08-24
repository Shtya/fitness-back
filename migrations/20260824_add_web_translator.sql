-- Browser translator: saved words, lookups, settings, short-lived pairing codes.

CREATE TABLE IF NOT EXISTS web_translator_words (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL,
	text varchar(500) NOT NULL,
	normalized_text varchar(500) NOT NULL,
	translation text NOT NULL,
	source_lang varchar(8) NOT NULL DEFAULT 'en',
	target_lang varchar(8) NOT NULL DEFAULT 'ar',
	pronunciation varchar(160) NULL,
	part_of_speech varchar(64) NULL,
	example text NULL,
	source_url text NULL,
	source_title varchar(240) NULL,
	lookup_count int NOT NULL DEFAULT 1,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_web_translator_word
	ON web_translator_words (user_id, normalized_text, source_lang, target_lang);
CREATE INDEX IF NOT EXISTS idx_web_translator_words_user_updated
	ON web_translator_words (user_id, updated_at);

CREATE TABLE IF NOT EXISTS web_translator_lookups (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL,
	word_id uuid NULL,
	text varchar(500) NOT NULL,
	translation text NOT NULL,
	source_lang varchar(8) NOT NULL,
	target_lang varchar(8) NOT NULL,
	pronunciation varchar(160) NULL,
	part_of_speech varchar(64) NULL,
	example text NULL,
	source_url text NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_web_translator_lookups_user_created
	ON web_translator_lookups (user_id, created_at);

CREATE TABLE IF NOT EXISTS web_translator_settings (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL,
	locale varchar(8) NOT NULL DEFAULT 'en',
	source_lang varchar(8) NOT NULL DEFAULT 'auto',
	target_lang varchar(8) NOT NULL DEFAULT 'ar',
	double_click_enabled boolean NOT NULL DEFAULT true,
	selection_enabled boolean NOT NULL DEFAULT true,
	updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_web_translator_settings_user
	ON web_translator_settings (user_id);

CREATE TABLE IF NOT EXISTS web_translator_pairings (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL,
	code_hash varchar(64) NOT NULL,
	expires_at timestamptz NOT NULL,
	used_at timestamptz NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_web_translator_pairings_hash
	ON web_translator_pairings (code_hash);
CREATE INDEX IF NOT EXISTS idx_web_translator_pairings_user
	ON web_translator_pairings (user_id);
