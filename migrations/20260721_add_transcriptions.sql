CREATE TABLE IF NOT EXISTS transcriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "originalFileName" varchar(255) NOT NULL,
    provider varchar(16) NOT NULL DEFAULT 'local',
    text text NOT NULL,
    "requestedLanguage" varchar(16) NOT NULL DEFAULT 'auto',
    "detectedLanguage" varchar(16),
    "customVocabulary" text,
    "durationSeconds" double precision NOT NULL DEFAULT 0,
    "processingTimeSeconds" double precision NOT NULL DEFAULT 0,
    "wordCount" integer NOT NULL DEFAULT 0,
    "characterCount" integer NOT NULL DEFAULT 0,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transcriptions_user_created
    ON transcriptions ("userId", "createdAt" DESC);
