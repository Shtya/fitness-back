CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE whatsapp_demo_contacts_presence_status_enum AS ENUM ('online', 'offline', 'away', 'typing', 'recording');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE whatsapp_demo_conversations_source_type_enum AS ENUM ('fake', 'real_overlay');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE whatsapp_demo_messages_direction_enum AS ENUM ('inbound', 'outbound', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE whatsapp_demo_messages_status_enum AS ENUM ('pending', 'sent', 'delivered', 'read', 'played', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE whatsapp_demo_messages_deleted_mode_enum AS ENUM ('none', 'for_me', 'for_everyone');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE whatsapp_demo_attachments_kind_enum AS ENUM ('image', 'video', 'audio', 'document', 'sticker');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE whatsapp_demo_events_event_type_enum AS ENUM ('typing', 'recording', 'incoming_message');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS whatsapp_demo_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  tenant_admin_id uuid NOT NULL,
  name varchar(120) NOT NULL,
  locale varchar(20) NOT NULL DEFAULT 'en',
  random_seed integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_demo_profiles_owner ON whatsapp_demo_profiles(user_id, tenant_admin_id);

CREATE TABLE IF NOT EXISTS whatsapp_demo_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  tenant_admin_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  active_profile_id uuid REFERENCES whatsapp_demo_profiles(id) ON DELETE SET NULL,
  flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_whatsapp_demo_settings_owner UNIQUE (user_id, tenant_admin_id)
);
CREATE INDEX IF NOT EXISTS idx_demo_settings_owner ON whatsapp_demo_settings(user_id, tenant_admin_id);

CREATE TABLE IF NOT EXISTS whatsapp_demo_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  tenant_admin_id uuid NOT NULL,
  profile_id uuid NOT NULL REFERENCES whatsapp_demo_profiles(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  photo_attachment_id uuid,
  avatar_color varchar(32),
  phone varchar(40),
  about text,
  verified boolean NOT NULL DEFAULT false,
  presence_status whatsapp_demo_contacts_presence_status_enum NOT NULL DEFAULT 'offline',
  last_seen_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_demo_contacts_profile_owner
  ON whatsapp_demo_contacts(profile_id, user_id, tenant_admin_id);

CREATE TABLE IF NOT EXISTS whatsapp_demo_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  tenant_admin_id uuid NOT NULL,
  profile_id uuid NOT NULL REFERENCES whatsapp_demo_profiles(id) ON DELETE CASCADE,
  source_type whatsapp_demo_conversations_source_type_enum NOT NULL,
  contact_id uuid REFERENCES whatsapp_demo_contacts(id) ON DELETE CASCADE,
  real_account_id varchar(255),
  real_conversation_id varchar(255),
  pinned boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  muted_until timestamptz,
  manual_order integer NOT NULL DEFAULT 0,
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ck_demo_conversation_source CHECK (
    (source_type = 'fake' AND contact_id IS NOT NULL AND real_account_id IS NULL AND real_conversation_id IS NULL)
    OR
    (source_type = 'real_overlay' AND contact_id IS NULL AND real_account_id IS NOT NULL AND real_conversation_id IS NOT NULL)
  ),
  CONSTRAINT uq_demo_real_overlay UNIQUE (profile_id, real_account_id, real_conversation_id)
);
CREATE INDEX IF NOT EXISTS idx_demo_conversations_profile_owner
  ON whatsapp_demo_conversations(profile_id, user_id, tenant_admin_id);

CREATE TABLE IF NOT EXISTS whatsapp_demo_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  tenant_admin_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES whatsapp_demo_conversations(id) ON DELETE CASCADE,
  direction whatsapp_demo_messages_direction_enum NOT NULL,
  type varchar(40) NOT NULL,
  text text,
  "timestamp" timestamptz NOT NULL,
  status whatsapp_demo_messages_status_enum NOT NULL DEFAULT 'sent',
  show_read_receipt boolean NOT NULL DEFAULT true,
  reply_to_id uuid REFERENCES whatsapp_demo_messages(id) ON DELETE SET NULL,
  forwarded boolean NOT NULL DEFAULT false,
  edited_at timestamptz,
  deleted_mode whatsapp_demo_messages_deleted_mode_enum NOT NULL DEFAULT 'none',
  location jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_demo_messages_conversation_time
  ON whatsapp_demo_messages(conversation_id, "timestamp");
CREATE INDEX IF NOT EXISTS idx_demo_messages_owner
  ON whatsapp_demo_messages(user_id, tenant_admin_id);

CREATE TABLE IF NOT EXISTS whatsapp_demo_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  tenant_admin_id uuid NOT NULL,
  profile_id uuid NOT NULL REFERENCES whatsapp_demo_profiles(id) ON DELETE CASCADE,
  message_id uuid REFERENCES whatsapp_demo_messages(id) ON DELETE CASCADE,
  kind whatsapp_demo_attachments_kind_enum NOT NULL,
  storage_key varchar(500) NOT NULL,
  file_name varchar(255) NOT NULL,
  mime_type varchar(120) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0)
);
CREATE INDEX IF NOT EXISTS idx_demo_attachments_profile_owner
  ON whatsapp_demo_attachments(profile_id, user_id, tenant_admin_id);
CREATE INDEX IF NOT EXISTS idx_demo_attachments_message ON whatsapp_demo_attachments(message_id);

DO $$ BEGIN
  ALTER TABLE whatsapp_demo_contacts
    ADD CONSTRAINT fk_demo_contact_photo
    FOREIGN KEY (photo_attachment_id) REFERENCES whatsapp_demo_attachments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS whatsapp_demo_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  tenant_admin_id uuid NOT NULL,
  message_id uuid NOT NULL REFERENCES whatsapp_demo_messages(id) ON DELETE CASCADE,
  emoji varchar(32) NOT NULL,
  actor_key varchar(160) NOT NULL DEFAULT 'contact'
);
CREATE INDEX IF NOT EXISTS idx_demo_reactions_message_owner
  ON whatsapp_demo_reactions(message_id, user_id, tenant_admin_id);

CREATE TABLE IF NOT EXISTS whatsapp_demo_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  tenant_admin_id uuid NOT NULL,
  profile_id uuid NOT NULL REFERENCES whatsapp_demo_profiles(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES whatsapp_demo_conversations(id) ON DELETE CASCADE,
  event_type whatsapp_demo_events_event_type_enum NOT NULL,
  delay_ms integer NOT NULL DEFAULT 0 CHECK (delay_ms >= 0),
  scheduled_at timestamptz,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  infinite boolean NOT NULL DEFAULT false,
  randomize boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  sequence integer NOT NULL DEFAULT 0 CHECK (sequence >= 0)
);
ALTER TABLE whatsapp_demo_events ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_demo_events_profile_sequence
  ON whatsapp_demo_events(profile_id, enabled, sequence);
CREATE INDEX IF NOT EXISTS idx_demo_events_owner
  ON whatsapp_demo_events(user_id, tenant_admin_id);
