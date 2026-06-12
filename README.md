# AI Native Loop

以群聊为交互形式的 AI 协作平台：人类与 PM / Dev / Ops Agent **平权协作**，通过灵活组合的**子任务流（WorkStream）**完成一次完整迭代（Loop）。

**代码仓库**：https://github.com/shangyehuazhinengjiance/loop

详细设计见 **[.loop/DESIGN.md](./.loop/DESIGN.md)**（v2 权威规格）。

> **状态**：v2 为默认版本；v1 已废弃（[退役计划](./.loop/V1_RETIREMENT.md)）。

## 文档

| 路径 | 说明 |
|------|------|
| [.loop/DESIGN.md](./.loop/DESIGN.md) | v2 技术方案 |
| [.loop/README.md](./.loop/README.md) | 项目说明、API、快速开始 |
| [.loop/HISTORY.md](./.loop/HISTORY.md) | 设计演进 |
| [.loop/V1_RETIREMENT.md](./.loop/V1_RETIREMENT.md) | v1 退役与 CI/K8s 切换 |

## v2 要点

- **子任务流**替代固定三阶段（requirement / development / deployment）
- 默认无 Playbook，靠 `@mention`、spawn、手动建流
- **工作流看板**为唯一进度视图
- 问题通过 reopen / spawn 单条流解决；关键 Run 才打 Git Summary Tag

## 快速开始（v2）

```bash
docker compose up -d
cp .env.example .env   # DATABASE_URL 指向 loop_v2

cd packages/orchestrator-v2 && pip install -r requirements.txt
npm run db:migrate:v2
npm run dev:orchestrator-v2   # :3000
npm run dev:agent-worker        # :3010
npm run dev:gateway             # :3001
npm run dev:web                 # :3002
```

打开 http://localhost:3002/v2 创建 Loop。

v1 旧版见 [.loop/README.md](./.loop/README.md)。

## 测试

```bash
npm run test -w @loop/shared
```
