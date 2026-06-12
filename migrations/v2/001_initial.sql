-- AI Native Loop v2 — 初始 Schema（MySQL 8.0+，无物理外键）

SET NAMES utf8mb4;

CREATE TABLE projects (
  id            CHAR(36)     NOT NULL,
  name          VARCHAR(255) NOT NULL,
  git_config    JSON         NOT NULL,
  model_config  JSON         NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE loops (
  id              CHAR(36)     NOT NULL,
  project_id      CHAR(36)     NOT NULL,
  title           VARCHAR(512) NOT NULL,
  status          VARCHAR(32)  NOT NULL DEFAULT 'active',
  git_branch      VARCHAR(255) NULL,
  workspace_path  VARCHAR(1024) NULL,
  context         JSON         NULL,
  model_overrides JSON         NULL,
  milestone       JSON         NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_loops_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE loop_members (
  loop_id       CHAR(36)     NOT NULL,
  user_id       VARCHAR(128) NOT NULL,
  display_name  VARCHAR(255) NOT NULL,
  bio           TEXT         NULL,
  joined_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (loop_id, user_id),
  INDEX idx_members_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workstream_templates (
  id              VARCHAR(64)  NOT NULL,
  name            VARCHAR(255) NOT NULL,
  owner_kind      VARCHAR(16)  NOT NULL,
  default_owner   VARCHAR(128) NULL,
  definition      JSON         NOT NULL,
  ephemeral       TINYINT(1)   NOT NULL DEFAULT 0,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workstream_instances (
  id            CHAR(36)     NOT NULL,
  loop_id       CHAR(36)     NOT NULL,
  template_id   VARCHAR(64)  NOT NULL,
  title         VARCHAR(512) NULL,
  assignee_id   VARCHAR(128) NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_instances_loop (loop_id),
  INDEX idx_instances_template (template_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workstream_runs (
  id              CHAR(36)     NOT NULL,
  instance_id     CHAR(36)     NOT NULL,
  loop_id         CHAR(36)     NOT NULL,
  template_id     VARCHAR(64)  NOT NULL,
  version         INT          NOT NULL,
  status          VARCHAR(32)  NOT NULL,
  owner_kind      VARCHAR(16)  NOT NULL,
  owner_id        VARCHAR(128) NOT NULL,
  assignee_id     VARCHAR(128) NULL,
  started_at      DATETIME(3)  NULL,
  ended_at        DATETIME(3)  NULL,
  started_by      VARCHAR(128) NULL,
  blocked_reason  TEXT         NULL,
  spawned_from    CHAR(36)     NULL,
  supersedes      CHAR(36)     NULL,
  git_ref_start   VARCHAR(64)  NULL,
  git_ref_end     VARCHAR(64)  NULL,
  summary_tag     VARCHAR(255) NULL,
  metadata        JSON         NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_runs_loop_status (loop_id, status),
  INDEX idx_runs_instance (instance_id, version),
  INDEX idx_runs_template (template_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workstream_dependencies (
  instance_id     CHAR(36)     NOT NULL,
  depends_on_id   CHAR(36)     NOT NULL,
  kind            VARCHAR(16)  NOT NULL DEFAULT 'hard',
  PRIMARY KEY (instance_id, depends_on_id),
  INDEX idx_deps_depends_on (depends_on_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workstream_events (
  id          CHAR(36)     NOT NULL,
  run_id      CHAR(36)     NOT NULL,
  loop_id     CHAR(36)     NOT NULL,
  event_type  VARCHAR(64)  NOT NULL,
  payload     JSON         NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_ws_events_loop (loop_id, created_at),
  INDEX idx_ws_events_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE messages (
  id              CHAR(36)     NOT NULL,
  loop_id         CHAR(36)     NOT NULL,
  run_id          CHAR(36)     NULL,
  sender_type     VARCHAR(16)  NOT NULL,
  sender_id       VARCHAR(128) NOT NULL,
  content         JSON         NOT NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_messages_loop (loop_id, created_at),
  INDEX idx_messages_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE action_records (
  id          CHAR(36)     NOT NULL,
  loop_id     CHAR(36)     NOT NULL,
  run_id      CHAR(36)     NULL,
  action      VARCHAR(64)  NOT NULL,
  actor_id    VARCHAR(128) NOT NULL,
  note        TEXT         NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_actions_loop (loop_id),
  INDEX idx_actions_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE artifacts (
  id          CHAR(36)     NOT NULL,
  loop_id     CHAR(36)     NOT NULL,
  run_id      CHAR(36)     NULL,
  type        VARCHAR(64)  NOT NULL,
  path        VARCHAR(1024) NULL,
  content     JSON         NULL,
  version     INT          NOT NULL DEFAULT 1,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_artifacts_loop (loop_id),
  INDEX idx_artifacts_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id          CHAR(36)     NOT NULL,
  loop_id     CHAR(36)     NULL,
  actor       VARCHAR(128) NOT NULL,
  action      VARCHAR(128) NOT NULL,
  detail      JSON         NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_audit_loop (loop_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
