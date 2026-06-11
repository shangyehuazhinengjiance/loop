-- AI Native Loop — 初始 Schema（MySQL 8.0+）

SET NAMES utf8mb4;

CREATE TABLE projects (
  id            CHAR(36)     NOT NULL,
  NAME          VARCHAR(255) NOT NULL,
  git_config    JSON         NOT NULL,
  model_config  JSON         NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=INNODB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE loops (
  id              CHAR(36)     NOT NULL,
  project_id      CHAR(36)     NOT NULL,
  title           VARCHAR(512) NOT NULL,
  STATUS          VARCHAR(64)  NOT NULL DEFAULT 'active',
  PHASE           VARCHAR(64)  NOT NULL DEFAULT 'created',
  git_branch      VARCHAR(255) NULL,
  workspace_path  TEXT         NULL,
  context         JSON         NOT NULL,
  model_overrides JSON         NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_loops_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
) ENGINE=INNODB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_loops_project_id ON loops (project_id);
CREATE INDEX idx_loops_phase ON loops (PHASE);

CREATE TABLE messages (
  id          CHAR(36)     NOT NULL,
  loop_id     CHAR(36)     NOT NULL,
  PHASE       VARCHAR(64)  NOT NULL,
  sender_type VARCHAR(64)  NOT NULL,
  sender_id   VARCHAR(255) NOT NULL,
  content     JSON         NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_messages_loop FOREIGN KEY (loop_id) REFERENCES loops (id) ON DELETE CASCADE
) ENGINE=INNODB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_messages_loop_id ON messages (loop_id, created_at);

CREATE TABLE snapshots (
  id                CHAR(36)     NOT NULL,
  loop_id           CHAR(36)     NOT NULL,
  PHASE             VARCHAR(64)  NOT NULL,
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
  CONSTRAINT fk_snapshots_loop FOREIGN KEY (loop_id) REFERENCES loops (id) ON DELETE CASCADE
) ENGINE=INNODB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_snapshots_loop_id ON snapshots (loop_id, created_at DESC);

DROP TABLE IF EXISTS approvals;


SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE loops CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE approvals (
  id          CHAR(36)     NOT NULL,
  loop_id     CHAR(36)     NOT NULL,
  ACTION      VARCHAR(64)  NOT NULL,
  approved_by VARCHAR(255) NOT NULL,
  note        TEXT         NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_approvals_loop FOREIGN KEY (loop_id) REFERENCES loops (id) ON DELETE CASCADE
) ENGINE=INNODB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE approvals (
  id          CHAR(36)     NOT NULL,
  loop_id     CHAR(36)     NOT NULL,
  ACTION      VARCHAR(64)  NOT NULL,
  approved_by VARCHAR(255) NOT NULL,
  note        TEXT         NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_approvals_loop FOREIGN KEY (loop_id) REFERENCES loops (id) ON DELETE CASCADE
) ENGINE=INNODB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE approvals (
  id          CHAR(36)     NOT NULL,
  loop_id     CHAR(36)     NOT NULL,
  ACTION      VARCHAR(64)  NOT NULL,
  approved_by VARCHAR(255) NOT NULL,
  note        TEXT         NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_approvals_loop FOREIGN KEY (loop_id) REFERENCES loops (id) ON DELETE CASCADE
) ENGINE=INNODB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_approvals_loop_id ON approvals (loop_id);

CREATE TABLE phase_transitions (
  id          CHAR(36)    NOT NULL,
  loop_id     CHAR(36)    NOT NULL,
  from_phase  VARCHAR(64) NULL,
  to_phase    VARCHAR(64) NOT NULL,
  `trigger`   VARCHAR(64) NOT NULL,
  snapshot_id CHAR(36)    NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_phase_transitions_loop FOREIGN KEY (loop_id) REFERENCES loops (id) ON DELETE CASCADE,
  CONSTRAINT fk_phase_transitions_snapshot FOREIGN KEY (snapshot_id) REFERENCES snapshots (id)
) ENGINE=INNODB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_phase_transitions_loop_id ON phase_transitions (loop_id, created_at DESC);
