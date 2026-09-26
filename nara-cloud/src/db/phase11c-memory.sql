ALTER TABLE nara_memory
  ADD COLUMN IF NOT EXISTS project_key TEXT,
  ADD COLUMN IF NOT EXISTS conversation_id UUID;

ALTER TABLE nara_memory
  DROP CONSTRAINT IF EXISTS nara_memory_type_check;

ALTER TABLE nara_memory
  ADD CONSTRAINT nara_memory_type_check
  CHECK (memory_type IN ('task','result','note','project','debug','short_term','long_term','conversation'));

CREATE INDEX IF NOT EXISTS idx_nara_memory_owner_scope_updated
  ON nara_memory(owner_id, memory_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_nara_memory_project
  ON nara_memory(owner_id, project_key, updated_at DESC)
  WHERE project_key IS NOT NULL;
