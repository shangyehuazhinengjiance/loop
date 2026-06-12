# PRD

# 产品需求文档 (PRD)

## 1. 需求背景
1. **消息时间显示异常**：当前系统在群聊界面中显示的消息时间比实际时间早了 8 个小时。由于系统底层数据库已迁移至 MySQL，时间字段（如 `created_at`）在存储和读取时的时区处理（UTC 与本地时区 UTC+8）存在偏差，导致前端展示未能正确转换。
2. **架构文档滞后**：系统底层数据库已经从 PostgreSQL 改为基于 MySQL 实现，但当前的技术架构文档（`DESIGN.md`）中仍遗留大量关于 PostgreSQL 的描述（如技术栈选型、数据库 Schema 示例、关键依赖等），需要一并进行修正以保持文档与实际架构的一致性。

## 2. 用户故事
- **作为一个** 参与 Loop 协作的用户
- **我希望** 群聊界面中的消息时间能够按照我的本地时区（如北京时间）准确显示
- **以便于** 我能准确判断消息的发送和接收时间，顺畅地进行协作。
- **作为一个** 开发者/系统维护者
- **我希望** 系统的技术架构文档（`DESIGN.md`）能准确反映当前使用的 MySQL 数据库
- **以便于** 后续的开发、维护和新成员的 onboarding 能够基于准确的架构信息。

## 3. 验收标准 (Acceptance Criteria)
1. **历史与实时消息时间显示**：前端（Web UI）刷新加载的历史消息以及通过 WebSocket 接收的实时消息，时间显示均需符合用户当前设备的本地时区（如 UTC+8）。
2. **时间格式规范**：后端（Orchestrator/Gateway）从 MySQL 读取并下发的时间统一保持为标准 ISO 8601 格式（带 `Z` 或时区标识），时区转换逻辑严格放在前端展示层处理。
3. **架构文档更新**：修改 `docs/DESIGN.md` 文件，将其中的 "PostgreSQL" 相关描述全部替换为 "MySQL"。包括但不限于：
   - 2.3 技术栈表格中的持久化选型。
   - 10. 数据库 Schema 章节，将 PostgreSQL 特有的语法（如 `UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `JSONB`, `TIMESTAMPTZ`）更新为兼容 MySQL 的语法（如 `VARCHAR(36)`, `JSON`, `DATETIME` 或 `TIMESTAMP`）。
   - 14. 关键依赖列表中的数据库说明。

---

# 任务拆解

```json
[
  {
    "id": "task-1",
    "title": "前端消息时间格式化修复",
    "description": "在 `packages/web` (Next.js) 的消息气泡组件中，检查时间渲染逻辑。将后端传入的 UTC 时间字符串转换为本地时区时间后再进行格式化显示（建议使用原生的 `Intl.DateTimeFormat` 或 `dayjs` 等时间库）。",
    "status": "todo",
    "assigneeUserId": "human-9d10e4b8",
    "assigneeDisplayName": "徐兴旺"
  },
  {
    "id": "task-2",
    "title": "后端时间戳格式校验与 MySQL 时区适配",
    "description": "在 `packages/orchestrator` 和 `packages/gateway` 中，确认从 MySQL 读取的时间字段在 REST API 和 WebSocket 下发时，均输出为标准的 ISO 8601 格式，确保前端能正确解析。",
    "status": "todo",
    "assigneeUserId": "human-9d10e4b8",
    "assigneeDisplayName": "徐兴旺"
  },
  {
    "id": "task-3",
    "title": "更新 DESIGN.md 数据库架构描述",
    "description": "修改 `docs/DESIGN.md`，将所有关于 PostgreSQL 的描述替换为 MySQL。重点更新第 10 节的数据库 Schema，将建表语句修改为 MySQL 语法（如处理 UUID、JSON 和时间字段）。",
    "status": "todo",
    "assigneeUserId": "human-9d10e4b8",
    "assigneeDisplayName": "徐兴旺"
  }
]
```

---
@human-9d10e4b8 需求已更新完毕，包含时间显示修复以及数据库设计文档的修正。如果确认无误，请点击**「确认需求」**按钮，随后 Dev Agent 将接手进行开发和文档修改。
