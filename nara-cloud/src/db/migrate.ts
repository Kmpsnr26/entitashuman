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

CREATE TABLE IF NOT EXISTS nara_memory (
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
  CONSTRAINT nara_memory_type_check
    CHECK (
      memory_type IN (
        'task',
        'result',
        'note',
        'project',
        'debug'
      )
    ),
  CONSTRAINT nara_memory_importance_check
    CHECK (importance BETWEEN 1 AND 5),
  CONSTRAINT nara_memory_title_check
    CHECK (char_length(title) BETWEEN 1 AND 160)
);

CREATE INDEX IF NOT EXISTS
idx_nara_memory_owner_updated
ON nara_memory(owner_id, updated_at DESC);

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

CREATE TABLE IF NOT EXISTS owner_auth_sessions (
  sid VARCHAR NOT NULL COLLATE "default",
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL,
  CONSTRAINT owner_auth_sessions_pkey PRIMARY KEY (sid)
);

CREATE INDEX IF NOT EXISTS
idx_owner_auth_sessions_expire
ON owner_auth_sessions(expire);

CREATE TABLE IF NOT EXISTS nara_app_sessions (
  sid VARCHAR NOT NULL COLLATE "default",
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL,
  CONSTRAINT nara_app_sessions_pkey PRIMARY KEY (sid)
);

CREATE INDEX IF NOT EXISTS
idx_nara_app_sessions_expire
ON nara_app_sessions(expire);
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
