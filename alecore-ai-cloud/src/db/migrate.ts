import { pool } from "./pool.js";

const migration = `
CREATE TABLE IF NOT EXISTS owner_users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  CONSTRAINT owner_users_display_name_check
    CHECK (char_length(display_name) BETWEEN 2 AND 80),
  CONSTRAINT owner_users_password_hash_check
    CHECK (password_hash LIKE '$argon2id$%')
);

CREATE UNIQUE INDEX IF NOT EXISTS
idx_owner_users_email_lower
ON owner_users (LOWER(email));

CREATE UNIQUE INDEX IF NOT EXISTS
idx_owner_users_single_active
ON owner_users ((is_active))
WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS login_tickets (
  id BIGSERIAL PRIMARY KEY,
  code_hash CHAR(64) NOT NULL UNIQUE,
  user_id UUID NOT NULL
    REFERENCES owner_users(id)
    ON DELETE CASCADE,
  audience TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT login_tickets_audience_check
    CHECK (
      char_length(audience) BETWEEN 1 AND 64
      AND audience ~ '^[a-z0-9._-]+$'
    ),
  CONSTRAINT login_tickets_code_hash_check
    CHECK (char_length(code_hash) = 64),
  CONSTRAINT login_tickets_user_audience_unique
    UNIQUE (user_id, audience)
);

CREATE INDEX IF NOT EXISTS
idx_login_tickets_expires
ON login_tickets(expires_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID
    REFERENCES owner_users(id)
    ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_logs_event_type_check
    CHECK (char_length(event_type) BETWEEN 1 AND 100)
);

CREATE INDEX IF NOT EXISTS
idx_audit_logs_user
ON audit_logs(user_id);

CREATE INDEX IF NOT EXISTS
idx_audit_logs_created
ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS alecore_ai_memory (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL
    REFERENCES owner_users(id)
    ON DELETE CASCADE,
  memory_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'cloud',
  importance INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT alecore_ai_memory_type_check
    CHECK (
      memory_type IN (
        'task',
        'result',
        'note',
        'project',
        'debug'
      )
    ),
  CONSTRAINT alecore_ai_memory_importance_check
    CHECK (importance BETWEEN 1 AND 5),
  CONSTRAINT alecore_ai_memory_title_check
    CHECK (char_length(title) BETWEEN 1 AND 160)
);

CREATE INDEX IF NOT EXISTS
idx_alecore_ai_memory_owner_updated
ON alecore_ai_memory(owner_id, updated_at DESC);

ALTER TABLE alecore_ai_memory
  ADD COLUMN IF NOT EXISTS project_key TEXT,
  ADD COLUMN IF NOT EXISTS conversation_id UUID;

ALTER TABLE alecore_ai_memory
  DROP CONSTRAINT IF EXISTS alecore_ai_memory_type_check;

ALTER TABLE alecore_ai_memory
  ADD CONSTRAINT alecore_ai_memory_type_check
  CHECK (
    memory_type IN (
      'task',
      'result',
      'note',
      'project',
      'debug',
      'short_term',
      'long_term',
      'conversation'
    )
  );

CREATE INDEX IF NOT EXISTS
idx_alecore_ai_memory_owner_scope_updated
ON alecore_ai_memory(owner_id, memory_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS
idx_alecore_ai_memory_project
ON alecore_ai_memory(owner_id, project_key, updated_at DESC)
WHERE project_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL
    REFERENCES owner_users(id)
    ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS
idx_conversations_owner_updated
ON conversations(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL
    REFERENCES conversations(id)
    ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT messages_role_check
    CHECK (role IN ('user', 'assistant'))
);

CREATE INDEX IF NOT EXISTS
idx_messages_conversation_created
ON messages(conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL,
  owner_id UUID NOT NULL
    REFERENCES owner_users(id)
    ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  input_chars INTEGER NOT NULL DEFAULT 0,
  output_chars INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  fallback_from TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_usage_logs_status_check
    CHECK (
      status IN (
        'success',
        'error',
        'aborted'
      )
    ),
  CONSTRAINT ai_usage_logs_nonnegative_check
    CHECK (
      input_chars >= 0
      AND output_chars >= 0
      AND latency_ms >= 0
      AND (
        input_tokens IS NULL
        OR input_tokens >= 0
      )
      AND (
        output_tokens IS NULL
        OR output_tokens >= 0
      )
      AND (
        total_tokens IS NULL
        OR total_tokens >= 0
      )
    )
);

CREATE INDEX IF NOT EXISTS
idx_ai_usage_owner_created
ON ai_usage_logs(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS
idx_ai_usage_request
ON ai_usage_logs(request_id);

CREATE TABLE IF NOT EXISTS owner_auth_sessions (
  sid VARCHAR NOT NULL COLLATE "default",
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL,
  CONSTRAINT owner_auth_sessions_pkey PRIMARY KEY (sid)
);

CREATE INDEX IF NOT EXISTS
idx_owner_auth_sessions_expire
ON owner_auth_sessions(expire);

CREATE TABLE IF NOT EXISTS alecore_ai_app_sessions (
  sid VARCHAR NOT NULL COLLATE "default",
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL,
  CONSTRAINT alecore_ai_app_sessions_pkey PRIMARY KEY (sid)
);

CREATE INDEX IF NOT EXISTS
idx_alecore_ai_app_sessions_expire
ON alecore_ai_app_sessions(expire);
`;

async function migrate(): Promise<void> {
  const client = await pool.connect();

  try {
    console.log("[DATABASE] Starting migration...");
    await client.query("BEGIN");
    await client.query(migration);
    await client.query("COMMIT");
    console.log("[DATABASE] Migration completed.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[DATABASE] Migration failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await migrate();
