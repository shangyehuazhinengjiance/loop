# 任务拆解

1. **前端消息时间格式化修复** (todo) — @human-9d10e4b8
   在 `packages/web` (Next.js) 的消息气泡组件中，检查时间渲染逻辑。将后端传入的 UTC 时间字符串转换为本地时区时间后再进行格式化显示（建议使用原生的 `Intl.DateTimeFormat` 或 `dayjs` 等时间库）。

2. **后端时间戳格式校验与 MySQL 时区适配** (todo) — @human-9d10e4b8
   在 `packages/orchestrator` 和 `packages/gateway` 中，确认从 MySQL 读取的时间字段在 REST API 和 WebSocket 下发时，均输出为标准的 ISO 8601 格式，确保前端能正确解析。

3. **更新 DESIGN.md 数据库架构描述** (todo) — @human-9d10e4b8
   修改 `docs/DESIGN.md`，将所有关于 PostgreSQL 的描述替换为 MySQL。重点更新第 10 节的数据库 Schema，将建表语句修改为 MySQL 语法（如处理 UUID、JSON 和时间字段）。