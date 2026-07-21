CREATE TABLE IF NOT EXISTS transcription_provider_credentials (
    provider varchar(32) PRIMARY KEY,
    "encryptedApiKey" text NOT NULL,
    "keyLastFour" varchar(8) NOT NULL,
    "updatedBy" uuid REFERENCES users(id) ON DELETE SET NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);
