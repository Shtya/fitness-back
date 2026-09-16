-- Saved media library: user-owned folders and items that outlive the chat they
-- came from, so converted voice notes can be re-sent without re-converting.

CREATE TABLE IF NOT EXISTS whatsapp_media_library_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_media_library_folders_name
  ON whatsapp_media_library_folders (user_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_media_library_folders_user
  ON whatsapp_media_library_folders(user_id);

CREATE TABLE IF NOT EXISTS whatsapp_media_library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Deleting a folder keeps its items; they fall back to the library root.
  folder_id uuid REFERENCES whatsapp_media_library_folders(id) ON DELETE SET NULL,
  title varchar(200) NOT NULL,
  media_type varchar(20) NOT NULL,
  mime_type varchar(160) NOT NULL,
  file_name varchar(300),
  storage_path varchar(1024) NOT NULL,
  file_size_bytes bigint,
  duration_seconds int,
  source varchar(20) NOT NULL DEFAULT 'attachment',
  -- Provenance only. The library never resolves the file through these.
  source_attachment_id uuid,
  source_conversation_id uuid,
  last_sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_media_library_items_user
  ON whatsapp_media_library_items(user_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_media_library_items_folder
  ON whatsapp_media_library_items(folder_id);
