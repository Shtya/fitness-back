-- Per-card completion (stay in column; sink to bottom on check)
ALTER TABLE whatsapp_board_cards
  ADD COLUMN IF NOT EXISTS is_completed boolean NOT NULL DEFAULT false;
