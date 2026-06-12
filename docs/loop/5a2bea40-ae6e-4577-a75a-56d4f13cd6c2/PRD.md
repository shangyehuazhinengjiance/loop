# PRD

# 产品需求文档 (PRD)：基于 Mention 的动态协作模式

## 1. 背景与目标
当前 AI Native Loop 系统采用了严格的 Phase 状态机（Requirement -> Development -> Deployment），跨阶段的协作（如开发中途发现需求漏洞需要修改）依赖于显式的 Rollback 机制，流程较重。
为了提供更自然的群聊协作体验，本需求旨在“模糊化”阶段概念，允许人类和 Agent 通过 `@mention` 的方式随时呼叫其他角色介入，实现动态的上下文切换与协作。

## 2. 用户故事
- **US-1**：作为人类用户，我希望在开发阶段（Development）可以直接在群聊中 `@pm-agent` 提出需求变更，而不需要手动点击回退按钮。
- **US-2**：作为 PM Agent，我希望在被 `@` 唤醒时，能读取当前的 PRD 和开发上下文，与用户讨论并增量更新 PRD，完成后再次提供「确认需求」按钮。
- **US-3**：作为 Dev Agent，我希望在 PM Agent 讨论期间被自动挂起，并在需求确认后自动恢复，同时能感知到最新修改的 PRD 并继续开发。

## 3. 核心功能设计

### 3.1 动态 Agent 路由与状态管理
- **Mention 解析**：Orchestrator 的消息总线需实时解析群聊消息中的 `@mention`。
- **Agent 挂起与恢复**：当在 Development 阶段 `@pm-agent` 时，Orchestrator 将当前活跃的 Dev Agent 状态置为 `suspended`，并激活 PM Agent。
- **无缝切换**：PM Agent 完成需求更新且人类点击「确认需求」后，Orchestrator 自动将 PM Agent 置为 `idle`，并 `resume` Dev Agent。

### 3.2 PM Agent 增量更新能力
- 当 PM Agent 在非 Requirement 阶段被唤醒时，其 Context 将包含当前的 `prd.md` 和 `tasks.json`。
- PM Agent 需具备“局部修改”能力，通过对话确认变更点后，输出更新后的 PRD 和任务列表，而不是从零重写。

### 3.3 Dev Agent 上下文热加载
- Dev Agent 从 `suspended` 恢复到 `active` 时，需触发一个特殊的 Hook 或系统提示，强制其重新读取 `context.prd` 和 `context.tasks`，以感知需求变更。

## 4. 验收标准 (Acceptance Criteria)
1. **跨阶段唤醒**：在 Development 阶段发送包含 `@pm-agent` 的消息，PM Agent 能够正常回复并介入对话。
2. **状态互斥与挂起**：PM Agent 活跃期间，Dev Agent 不会抢答或继续执行工具调用。
3. **需求重确认闭环**：PM Agent 修改需求后，人类点击「确认需求」，系统能自动唤醒 Dev Agent 继续工作。
4. **上下文一致性**：Dev Agent 恢复后，其后续的代码修改能体现出 PM Agent 刚刚更新的需求内容。

---

# 任务拆解

```json
[
  {
    "id": "task-1",
    "title": "Orchestrator: 消息路由与 Agent 挂起/恢复机制",
    "description": "修改 Orchestrator 消息处理逻辑，支持解析跨阶段的 @mention。引入 Agent 级别的 suspended 状态，实现活跃 Agent 的平滑切换。",
    "status": "todo",
    "assigneeUserId": "human-ab44e6c8",
    "assigneeDisplayName": "徐兴旺"
  },
  {
    "id": "task-2",
    "title": "PM Agent: 支持非初始阶段的增量需求更新",
    "description": "调整 PM Agent 的 System Prompt 和处理逻辑，使其在已有 PRD 的情况下被唤醒时，能基于现有内容进行 diff 更新，并重新触发审批卡点。",
    "status": "todo",
    "assigneeUserId": "human-ab44e6c8",
    "assigneeDisplayName": "徐兴旺"
  },
  {
    "id": "task-3",
    "title": "Dev Agent: 恢复执行时的上下文热加载",
    "description": "在 Dev Agent SDK 中增加 resume 时的上下文校验机制，确保其能读取到最新的 context.prd 和 context.tasks。",
    "status": "todo",
    "assigneeUserId": "human-ab44e6c8",
    "assigneeDisplayName": "徐兴旺"
  },
  {
    "id": "task-4",
    "title": "Web UI: 弱化阶段展示与 Mention 交互优化",
    "description": "在前端群聊界面中，弱化顶部严格的 Phase 进度条，增强输入框的 @ 提及补全提示，并在消息流中清晰展示 Agent 的介入与退出状态。",
    "status": "todo",
    "assigneeUserId": "human-ab44e6c8",
    "assigneeDisplayName": "徐兴旺"
  }
]
```

请人类确认以上需求与任务拆解，若无问题，请点击「确认需求」按钮以进入开发阶段。
