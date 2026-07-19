CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE whatsapp_account_status AS ENUM ('disconnected', 'connecting', 'qr_pending', 'connected', 'error');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE whatsapp_conversation_type AS ENUM ('direct', 'group');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE whatsapp_message_direction AS ENUM ('inbound', 'outbound');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE whatsapp_message_status AS ENUM ('pending', 'sent', 'delivered', 'read', 'played', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
DECLARE
  enum_name text;
BEGIN
  SELECT t.typname
  INTO enum_name
  FROM pg_type t
  JOIN pg_enum e ON t.oid = e.enumtypid
  WHERE e.enumlabel = 'FORM_SUBMISSION'
  LIMIT 1;

  IF enum_name IS NULL THEN
    RAISE NOTICE 'Notification enum not found; WhatsApp notification values were not added';
    RETURN;
  END IF;

  EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', enum_name, 'WHATSAPP_MESSAGE');
  EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', enum_name, 'WHATSAPP_ASSIGNMENT');
  EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', enum_name, 'WHATSAPP_CONNECTION');
END $$;

CREATE TABLE IF NOT EXISTS whatsapp_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  label varchar(120) NOT NULL,
  owner_admin_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_number varchar(40),
  provider_name varchar(40) NOT NULL DEFAULT 'wppconnect',
  status whatsapp_account_status NOT NULL DEFAULT 'disconnected',
  last_connected_at timestamptz,
  last_error text,
  provider_capabilities jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_owner ON whatsapp_accounts(owner_admin_id);

CREATE TABLE IF NOT EXISTS whatsapp_account_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_view boolean NOT NULL DEFAULT true,
  can_use boolean NOT NULL DEFAULT false,
  can_manage boolean NOT NULL DEFAULT false,
  can_assign boolean NOT NULL DEFAULT false,
  can_transfer boolean NOT NULL DEFAULT false,
  CONSTRAINT uq_whatsapp_account_access UNIQUE (account_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_account_access_user ON whatsapp_account_access(user_id);

CREATE TABLE IF NOT EXISTS whatsapp_provider_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  provider_name varchar(40) NOT NULL,
  encrypted_data text NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT uq_whatsapp_provider_session UNIQUE (account_id, provider_name)
);

CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  wa_id varchar(160) NOT NULL,
  phone_number varchar(40),
  name varchar(200),
  avatar_url varchar(1024),
  is_business boolean NOT NULL DEFAULT false,
  CONSTRAINT uq_whatsapp_contact_account_wa_id UNIQUE (account_id, wa_id)
);

CREATE TABLE IF NOT EXISTS whatsapp_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  wa_id varchar(160) NOT NULL,
  subject varchar(240) NOT NULL,
  description text,
  owner_wa_id varchar(160),
  participant_count integer NOT NULL DEFAULT 0,
  metadata_synced_at timestamptz,
  CONSTRAINT uq_whatsapp_group_account_wa_id UNIQUE (account_id, wa_id)
);

CREATE TABLE IF NOT EXISTS whatsapp_group_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  group_id uuid NOT NULL REFERENCES whatsapp_groups(id) ON DELETE CASCADE,
  wa_id varchar(160) NOT NULL,
  display_name varchar(200),
  is_admin boolean NOT NULL DEFAULT false,
  is_super_admin boolean NOT NULL DEFAULT false,
  CONSTRAINT uq_whatsapp_group_participant UNIQUE (group_id, wa_id)
);

CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  type whatsapp_conversation_type NOT NULL,
  provider_chat_id varchar(160) NOT NULL,
  contact_id uuid REFERENCES whatsapp_contacts(id) ON DELETE SET NULL,
  group_id uuid UNIQUE REFERENCES whatsapp_groups(id) ON DELETE SET NULL,
  assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  last_message_at timestamptz,
  last_provider_sync_at timestamptz,
  oldest_provider_cursor varchar(300),
  has_more_provider_history boolean NOT NULL DEFAULT true,
  unread_count integer NOT NULL DEFAULT 0,
  is_closed boolean NOT NULL DEFAULT false,
  CONSTRAINT uq_whatsapp_conversation_account_chat UNIQUE (account_id, provider_chat_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_account ON whatsapp_conversations(account_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_assignee ON whatsapp_conversations(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_last_message ON whatsapp_conversations(last_message_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_conversation_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action varchar(20) NOT NULL CHECK (action IN ('assign', 'unassign', 'transfer')),
  previous_user_id uuid,
  note text
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_assignments_conversation ON whatsapp_conversation_assignments(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  provider_message_id varchar(300) NOT NULL,
  provider_name varchar(40) NOT NULL,
  direction whatsapp_message_direction NOT NULL,
  sender_wa_id varchar(160),
  sender_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  type varchar(40) NOT NULL,
  text text,
  status whatsapp_message_status NOT NULL DEFAULT 'pending',
  status_updated_at timestamptz,
  quoted_provider_message_id varchar(300),
  provider_timestamp timestamptz NOT NULL,
  raw jsonb,
  CONSTRAINT uq_whatsapp_message_account_provider UNIQUE (account_id, provider_message_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_timestamp
  ON whatsapp_messages(conversation_id, provider_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_sender_user ON whatsapp_messages(sender_user_id);

CREATE TABLE IF NOT EXISTS whatsapp_message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  message_id uuid NOT NULL REFERENCES whatsapp_messages(id) ON DELETE CASCADE,
  type varchar(40) NOT NULL,
  mime_type varchar(160),
  file_name varchar(300),
  file_size_bytes bigint,
  provider_media_id varchar(300),
  storage_path varchar(1024),
  download_status varchar(30) NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS whatsapp_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  provider_status_id varchar(300) NOT NULL,
  sender_wa_id varchar(160),
  type varchar(40) NOT NULL,
  caption text,
  is_own boolean NOT NULL DEFAULT false,
  published_at timestamptz NOT NULL,
  expires_at timestamptz,
  media_path varchar(1024),
  CONSTRAINT uq_whatsapp_status_account_provider UNIQUE (account_id, provider_status_id)
);

CREATE TABLE IF NOT EXISTS whatsapp_connection_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  event varchar(80) NOT NULL,
  message text,
  metadata jsonb
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_connection_logs_account
  ON whatsapp_connection_logs(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  account_id uuid,
  action varchar(120) NOT NULL,
  target_type varchar(80),
  target_id varchar(160),
  metadata jsonb
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_audit_logs_account
  ON whatsapp_audit_logs(account_id, created_at DESC);
