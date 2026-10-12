CREATE TABLE IF NOT EXISTS whatsapp_message_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  message_id uuid NOT NULL,
  participant_key varchar(200) NOT NULL,
  delivered_at timestamptz NULL,
  read_at timestamptz NULL,
  played_at timestamptz NULL,
  CONSTRAINT fk_whatsapp_message_receipt_message
    FOREIGN KEY (message_id)
    REFERENCES whatsapp_messages(id)
    ON DELETE CASCADE,
  CONSTRAINT uq_whatsapp_message_receipt_participant
    UNIQUE (message_id, participant_key)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_receipts_message_id
  ON whatsapp_message_receipts(message_id);
