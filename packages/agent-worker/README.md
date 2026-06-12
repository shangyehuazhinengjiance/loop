# Agent Worker

v2 Agent 执行服务：接收 Orchestrator 调度，运行 PM / Dev / Ops Agent。

## 开发

```bash
# 仓库根目录
npm run dev:agent-worker   # :3010
```

需同时运行 `dev:orchestrator-v2`。Agent 模型 Key 配置见 `.env.example`。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/internal/runs/start` | 启动 Run（Orchestrator 调用） |
| POST | `/internal/runs/cancel` | 取消 Run |

## Docker

```bash
docker build -f Dockerfile.agent-worker -t loop-agent-worker .
```
