# ⚠️ DEPRECATED — v1 NestJS Orchestrator

此包为 **v1 实现**，已被 `packages/orchestrator-v2`（FastAPI）替代。

- **新功能**：请在 `orchestrator-v2` 开发
- **默认 UI**：http://localhost:3002/v2
- **退役计划**：[.loop/V1_RETIREMENT.md](../../.loop/V1_RETIREMENT.md)

本地启动 v1（仅维护 legacy Loop 时使用）：

```bash
DATABASE_URL=mysql://loop:loop@localhost:3306/loop npm run db:migrate
npm run dev:orchestrator
```
