-- Loop 成员 + 阻塞状态
-- 对齐 CHAR(36) 外键列的字符集/排序规则，避免 MySQL 3780

ALTER TABLE loops
  MODIFY id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

CREATE TABLE IF NOT EXISTS loop_members (
  loop_id       CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  user_id       VARCHAR(255) NOT NULL,
  display_name  VARCHAR(64)  NOT NULL,
  bio           TEXT         NOT NULL DEFAULT '',
  joined_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (loop_id, user_id),
  KEY idx_loop_members_loop (loop_id),
  CONSTRAINT fk_loop_members_loop FOREIGN KEY (loop_id) REFERENCES loops (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE loops ADD COLUMN blocker JSON NULL;
