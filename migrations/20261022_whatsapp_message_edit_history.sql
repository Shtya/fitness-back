-- Text versions of WhatsApp messages before each edit (customer, linked phone, or CRM staff).
-- Shape: [{ "previousText": "...", "text": "...", "editedAt": "<ISO UTC>", "by": "contact" | "phone" | "staff" }]
-- Also applied idempotently at boot by WhatsAppSchemaService.

ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS edit_history jsonb;
