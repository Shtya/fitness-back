CREATE TABLE IF NOT EXISTS whatsapp_message_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(160),
  type varchar(32) NOT NULL DEFAULT 'text',
  text text,
  caption text,
  file_id varchar(1024),
  quoted_provider_message_id varchar(128),
  schedule_kind varchar(16) NOT NULL DEFAULT 'once',
  scheduled_at timestamptz,
  time_of_day varchar(8),
  timezone varchar(64) NOT NULL DEFAULT 'Asia/Qatar',
  days_of_week jsonb NOT NULL DEFAULT '[]'::jsonb,
  recurrence_start_date date,
  recurrence_end_date date,
  next_run_at timestamptz,
  last_run_at timestamptz,
  status varchar(16) NOT NULL DEFAULT 'active',
  client_message_id varchar(120),
  last_error text
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_schedules_account
  ON whatsapp_message_schedules(account_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_schedules_due
  ON whatsapp_message_schedules(status, next_run_at)
  WHERE deleted_at IS NULL AND status = 'active';

CREATE TABLE IF NOT EXISTS whatsapp_message_schedule_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  schedule_id uuid NOT NULL REFERENCES whatsapp_message_schedules(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  status varchar(16) NOT NULL DEFAULT 'active',
  last_sent_at timestamptz,
  last_error text
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_message_schedule_recipient
  ON whatsapp_message_schedule_recipients(schedule_id, conversation_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_schedule_recipients_conversation
  ON whatsapp_message_schedule_recipients(conversation_id, status);

CREATE TABLE IF NOT EXISTS whatsapp_message_schedule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  schedule_id uuid NOT NULL REFERENCES whatsapp_message_schedules(id) ON DELETE CASCADE,
  run_at timestamptz NOT NULL DEFAULT now(),
  status varchar(16) NOT NULL DEFAULT 'running',
  total_recipients int NOT NULL DEFAULT 0,
  sent_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_schedule_runs_schedule
  ON whatsapp_message_schedule_runs(schedule_id, run_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_message_schedule_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  run_id uuid NOT NULL REFERENCES whatsapp_message_schedule_runs(id) ON DELETE CASCADE,
  schedule_id uuid NOT NULL REFERENCES whatsapp_message_schedules(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES whatsapp_message_schedule_recipients(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  status varchar(16) NOT NULL DEFAULT 'pending',
  sent_message_id uuid REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
  attempt_count int NOT NULL DEFAULT 0,
  last_error text,
  client_message_id varchar(160) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_message_schedule_delivery_client
  ON whatsapp_message_schedule_deliveries(client_message_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_schedule_deliveries_run
  ON whatsapp_message_schedule_deliveries(run_id);
