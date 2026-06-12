# 关键设计决策（v2）

> 供后续开发/AI 会话快速对齐，权威细节见 [DESIGN.md](./DESIGN.md)。

## 产品

- Loop = 群聊 + Git 工作区 + 多条 **WorkStream**（子任务流）
- **无默认 Playbook**；创建 Loop 时不自动创建任何流
- Human 与 Agent **平权**；PM 流示例：@pm-agent 开始，PRD.md commit 结束
- 进度只看 **工作流看板**（进行中 / 等待 / 阻塞 / 已完成），无 phase 视图

## 子任务流

- 三层：`Template` → `Instance` → `Run`（version 递增）
- 发现问题：**spawn** 新流 或 **reopen** 已有 Instance，不用全局 rollback
- 同 owner 同时只有一个 `active` Run；不同 owner 可并行
- Human 结束：`end_any_of`（按钮、chat_intent 需确认卡、webhook、peer_confirm）

## Git

- 每 Loop 分支：`loop/{loopId}`
- 仅关键 Run 打 Tag：`loop/{id}/summary/{prd|dev|staging|release}-v{n}`
- `ephemeral: true` 的流（澄清、临时人工任务）**永不打 Tag**

## 技术

- 新库 **loop_v2**，不迁移 v1 数据
- MySQL **不使用外键**；关联靠 ID + 索引，引用完整性由应用层保证
- Agent Worker 独立服务（`:3010`），Orchestrator 通过 HTTP 调度
- Orchestrator：FastAPI；Agent：Node + 现有 PM/Dev/Ops 包
- Docker：拆 orchestrator / agent-worker / gateway / web 四镜像

## 内置模板（首版）

`pm-prd`, `pm-revision`, `pm-clarify`, `dev-impl`, `human-mr-merge`, `human-test-verify`, `ops-deploy-test`, `ops-deploy-prod`, `human-freeform`
