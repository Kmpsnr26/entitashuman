ALTER TABLE alecore_ai_memory
  ADD COLUMN IF NOT EXISTS project_key TEXT,
  ADD COLUMN IF NOT EXISTS conversation_id UUID;

ALTER TABLE alecore_ai_memory
  DROP CONSTRAINT IF EXISTS alecore_ai_memory_type_check;

ALTER TABLE alecore_ai_memory
  ADD CONSTRAINT alecore_ai_memory_type_check
  CHECK (memory_type IN ('task','result','note','project','debug','short_term','long_term','conversation'));

CREATE INDEX IF NOT EXISTS idx_alecore_ai_memory_owner_scope_updated
  ON alecore_ai_memory(owner_id, memory_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_alecore_ai_memory_project
  ON alecore_ai_memory(owner_id, project_key, updated_at DESC)
  WHERE project_key IS NOT NULL;
