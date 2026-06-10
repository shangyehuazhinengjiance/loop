-- Artifact 版本管理 + 审计日志 + 审批阶段维度（MySQL 8.0+）

ALTER TABLE approvals ADD COLUMN phase VARCHAR(64) NULL;

CREATE INDEX idx_approvals_loop_phase_action ON approvals (loop_id, phase, action);

CREATE TABLE artifacts (
  id          CHAR(36)     NOT NULL,
  loop_id     CHAR(36)     NOT NULL,
  phase       VARCHAR(64)  NOT NULL,
  type        VARCHAR(64)  NOT NULL,
  name        VARCHAR(255) NOT NULL,
  version     INT          NOT NULL DEFAULT 1,
  content     JSON         NOT NULL,
  diff_from   CHAR(36)     NULL,
  created_by  VARCHAR(255) NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_artifacts_loop FOREIGN KEY (loop_id) REFERENCES loops (id) ON DELETE CASCADE,
  CONSTRAINT fk_artifacts_diff_from FOREIGN KEY (diff_from) REFERENCES artifacts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_artifacts_loop_id ON artifacts (loop_id, type, version DESC);

CREATE TABLE audit_logs (
  id          CHAR(36)     NOT NULL,
  loop_id     CHAR(36)     NOT NULL,
  agent       VARCHAR(255) NULL,
  action      VARCHAR(255) NOT NULL,
  detail      JSON         NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_audit_logs_loop FOREIGN KEY (loop_id) REFERENCES loops (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_audit_logs_loop_id ON audit_logs (loop_id, created_at DESC);
