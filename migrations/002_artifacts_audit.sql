-- Artifact 版本管理 + 审计日志 + 审批阶段维度

ALTER TABLE approvals ADD COLUMN IF NOT EXISTS phase TEXT;

CREATE INDEX IF NOT EXISTS idx_approvals_loop_phase_action
  ON approvals(loop_id, phase, action);

CREATE TABLE IF NOT EXISTS artifacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_id     UUID NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
  phase       TEXT NOT NULL,
  type        TEXT NOT NULL,
  name        TEXT NOT NULL,
  version     INT NOT NULL DEFAULT 1,
  content     JSONB NOT NULL,
  diff_from   UUID REFERENCES artifacts(id),
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artifacts_loop_id
  ON artifacts(loop_id, type, version DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_id     UUID NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
  agent       TEXT,
  action      TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_loop_id
  ON audit_logs(loop_id, created_at DESC);
