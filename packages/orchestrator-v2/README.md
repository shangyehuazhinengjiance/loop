# Loop Orchestrator v2 (FastAPI)

v2 编排服务：子任务流（WorkStream）生命周期、群聊消息、SSE 事件。

## 要求

- Python 3.11+
- MySQL 8（`docker compose up -d`）

## 安装

```bash
pip install -r requirements.txt
```

## 迁移

在仓库根目录：

```bash
npm run db:migrate:v2
```

或在本目录：

```bash
python -m app.migrate
```

会创建 `loop_v2` 数据库（若不存在）并应用 `migrations/v2/*.sql`。

## 开发

在仓库根目录：

```bash
npm run dev:orchestrator-v2
```

API 文档：http://localhost:3000/docs

## 主要端点

- `GET /api/health`
- `POST /api/projects` / `POST /api/projects/{id}/loops`
- `GET /api/loops/{id}/workstreams/board`
- `POST /api/loops/{id}/workstreams/spawn`
- `POST /api/loops/{id}/messages`（支持 `@pm-agent` 等）
- `GET /api/loops/{id}/events`（SSE，Gateway 订阅）
