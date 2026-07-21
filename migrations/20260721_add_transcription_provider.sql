ALTER TABLE transcriptions
    ADD COLUMN IF NOT EXISTS provider varchar(16) NOT NULL DEFAULT 'local';
