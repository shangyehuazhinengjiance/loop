-- AI Native Loop — 初始 Schema
-- 对应 DESIGN.md §10

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  git_config    JSONB NOT NULL DEFAULT '{}',
  model_config  JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE loops (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  phase           TEXT NOT NULL DEFAULT 'created',
  git_branch      TEXT,
  workspace_path  TEXT,
  context         JSONB NOT NULL DEFAULT '{}',
  model_overrides JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_loops_project_id ON loops(project_id);
CREATE INDEX idx_loops_phase ON loops(phase);

CREATE TABLE messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_id     UUID NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
  phase       TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  sender_id   TEXT NOT NULL,
  content     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_loop_id ON messages(loop_id, created_at);

CREATE TABLE snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_id           UUID NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
  phase             TEXT NOT NULL,
  label             TEXT,
  prd               JSONB,
  tasks             JSONB,
  git_ref           TEXT,
  git_branch        TEXT,
  dev_session_id    TEXT,
  message_watermark UUID,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_snapshots_loop_id ON snapshots(loop_id, created_at DESC);

CREATE TABLE approvals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_id     UUID NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_approvals_loop_id ON approvals(loop_id);

CREATE TABLE phase_transitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_id     UUID NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
  from_phase  TEXT,
  to_phase    TEXT NOT NULL,
  trigger     TEXT NOT NULL,
  snapshot_id UUID REFERENCES snapshots(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_phase_transitions_loop_id ON phase_transitions(loop_id, created_at DESC);
