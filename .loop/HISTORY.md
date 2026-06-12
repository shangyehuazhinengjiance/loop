# 设计演进记录

## v1.0（2026-06-09）

- 固定 Pipeline：`created → requirement → development → deployment → done`
- 中心化 Phase 状态机，Human 审批驱动阶段流转
- 全局 rollback 回退到上游阶段
- Agent 由阶段自动激活；同一 Loop 同时仅一个 Agent active
- Snapshot + Git tag 绑定阶段完成点
- 技术栈：NestJS Orchestrator + MySQL + Next.js Web + PM/Dev/Ops Agent

**局限**：开发中发现需求问题、部署中发现代码问题等场景，只能粗粒度 rollback，与真实协作不匹配。

---

## v2.0 设计定稿（2026-06-12）

### 动机

实际协作中非线性：开发中需改需求、部署中需改代码或需求。固定三阶段无法表达并行、局部重开等场景。

### 核心变更

| 项 | v2 决策 |
|----|---------|
| 进度模型 | **子任务流（WorkStream）** 替代 Phase |
| 参与者 | Human 与 Agent **平权**，各自独立工作流 |
| 默认编排 | **无 Playbook**，@mention / spawn / 手动建流 |
| 问题处理 | **spawn / reopen** 单条流，非全局 rollback |
| Human 结束 | **灵活多通道**（按钮、chat 意图、webhook、peer 确认） |
| Git Tag | 仅**关键 Run** 打 Summary Tag；临时澄清不打 Tag |
| UI | **工作流看板**为唯一进度视图 |
| 数据 | **全新 MySQL schema**，不兼容 v1；**不使用外键**，建表与迁移更简单 |
| 部署 | Orchestrator 与 Agent Worker **拆镜像**；Orchestrator 倾向 FastAPI |

### 文档

- 完整规格：[DESIGN.md](./DESIGN.md) v2.0
- 决策摘要：[MEMORY.md](./MEMORY.md)

### 实施状态

- [x] v2 设计文档
- [x] v2 MySQL schema（`migrations/v2/`，无物理外键）
- [x] `config/workstream-templates.yaml` 种子模板
- [x] `packages/orchestrator-v2` FastAPI 编排（Phase 1 核心 API）
- [x] Web v2 看板 + 简化群聊（`/v2`）
- [x] Git 工作区 init + Summary Tag（Phase 2）
- [x] `packages/agent-worker` + Agent 调度（Phase 2）
- [x] 依赖解析 + Human chat_intent 确认卡（Phase 2 基础）
- [x] 看板依赖简图 + Summary Tag 时间线 + Loop 统计侧栏（Phase 3）
- [x] 审计、回放 API + Web UI（Phase 3）
- [x] Artifact 版本 API（Phase 3 后端）
- [x] `Dockerfile.orchestrator-v2` + agent-worker 读 `agents.yaml` / LiteLLM（Phase 3）
- [ ] Dev Subagents / MCP 深度集成（Dev Agent 已有 subagents 定义，v2 联调待验证）
- [x] Docker 四镜像 CI 流水线更新（Phase 3 + 退役 Phase A）
- [x] v1 退役 Phase A（文档、重定向、废弃标记）
- [ ] v1 退役 Phase B/C（代码删除，见 [V1_RETIREMENT.md](./V1_RETIREMENT.md)）
