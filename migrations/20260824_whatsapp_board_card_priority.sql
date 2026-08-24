-- Card priority levels for task board (low | medium | high | urgent)
ALTER TABLE whatsapp_board_cards
  ADD COLUMN IF NOT EXISTS priority varchar(16) NOT NULL DEFAULT 'medium';

UPDATE whatsapp_board_cards
SET priority = CASE WHEN is_starred THEN 'high' ELSE 'medium' END
WHERE priority IS NULL OR priority = 'medium';
