-- AI Native Loop — MySQL 首次部署全量建表脚本
-- 要求：MySQL 8.0+
--
-- 用法：
--   1. 先建库（若尚未创建）：
--        CREATE DATABASE loop CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--   2. 选中库后执行本文件：
--        mysql -h HOST -u USER -p loop < deploy/mysql-init.sql
--   或在客户端中：USE loop; 然后粘贴执行全文
--
-- 说明：已合并 001_initial + 002_artifacts_audit，无需再跑 migrate-job

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id            CHAR(36)     NOT NULL,
  name          VARCHAR(255) NOT NULL,
  git_config    JSON         NOT NULL,
  model_config  JSON         NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- loops
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loops (
  id              CHAR(36)     NOT NULL,
  project_id      CHAR(36)     NOT NULL,
  title           VARCHAR(512) NOT NULL,
  status          VARCHAR(64)  NOT NULL DEFAULT 'active',
  phase           VARCHAR(64)  NOT NULL DEFAULT 'created',
  git_branch      VARCHAR(255) NULL,
  workspace_path  TEXT         NULL,
  context         JSON         NOT NULL,
  model_overrides JSON         NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_loops_project_id (project_id),
  KEY idx_loops_phase (phase),
  CONSTRAINT fk_loops_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id          CHAR(36)     NOT NULL,
  loop_id     CHAR(36)     NOT NULL,
  phase       VARCHAR(64)  NOT NULL,
  sender_type VARCHAR(64)  NOT NULL,
  sender_id   VARCHAR(255) NOT NULL,
  content     JSON         NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_messages_loop_id (loop_id, created_at),
  CONSTRAINT fk_messages_loop FOREIGN KEY (loop_id) REFERENCES loops (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snapshots (
  id                CHAR(36)     NOT NULL,
  loop_id           CHAR(36)     NOT NULL,
  phase             VARCHAR(64)  NOT NULL,
  label             VARCHAR(255) NULL,
  prd               JSON         NULL,
  tasks             JSON         NULL,
  git_ref           VARCHAR(255) NULL,
  git_branch        VARCHAR(255) NULL,
  dev_session_id    VARCHAR(255) NULL,
  message_watermark CHAR(36)     NULL,
  created_by        VARCHAR(255) NULL,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_snapshots_loop_id (loop_id, created_at DESC),
  CONSTRAINT fk_snapshots_loop FOREIGN KEY (loop_id) REFERENCES loops (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- approvals（含 phase 列，对应 002 迁移）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approvals (
  id          CHAR(36)     NOT NULL,
  loop_id     CHAR(36)     NOT NULL,
  action      VARCHAR(64)  NOT NULL,
  approved_by VARCHAR(255) NOT NULL,
  note        TEXT         NULL,
  phase       VARCHAR(64)  NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_approvals_loop_id (loop_id),
  KEY idx_approvals_loop_phase_action (loop_id, phase, action),
  CONSTRAINT fk_approvals_loop FOREIGN KEY (loop_id) REFERENCES loops (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- phase_transitions（trigger 为 MySQL 保留字，需反引号）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS phase_transitions (
  id          CHAR(36)    NOT NULL,
  loop_id     CHAR(36)    NOT NULL,
  from_phase  VARCHAR(64) NULL,
  to_phase    VARCHAR(64) NOT NULL,
  `trigger`   VARCHAR(64) NOT NULL,
  snapshot_id CHAR(36)    NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_phase_transitions_loop_id (loop_id, created_at DESC),
  CONSTRAINT fk_phase_transitions_loop FOREIGN KEY (loop_id) REFERENCES loops (id) ON DELETE CASCADE,
  CONSTRAINT fk_phase_transitions_snapshot FOREIGN KEY (snapshot_id) REFERENCES snapshots (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- artifacts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifacts (
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
  KEY idx_artifacts_loop_id (loop_id, type, version DESC),
  CONSTRAINT fk_artifacts_loop FOREIGN KEY (loop_id) REFERENCES loops (id) ON DELETE CASCADE,
  CONSTRAINT fk_artifacts_diff_from FOREIGN KEY (diff_from) REFERENCES artifacts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          CHAR(36)     NOT NULL,
  loop_id     CHAR(36)     NOT NULL,
  agent       VARCHAR(255) NULL,
  action      VARCHAR(255) NOT NULL,
  detail      JSON         NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_logs_loop_id (loop_id, created_at DESC),
  CONSTRAINT fk_audit_logs_loop FOREIGN KEY (loop_id) REFERENCES loops (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 迁移版本记录（可选：日后若改用 migrate，会跳过已应用的脚本）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    VARCHAR(255) NOT NULL,
  applied_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (version) VALUES
  ('001_initial.sql'),
  ('002_artifacts_audit.sql');

SET FOREIGN_KEY_CHECKS = 1;
