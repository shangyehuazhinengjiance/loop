# 任务拆解

1. **Orchestrator: 消息路由与 Agent 挂起/恢复机制** (todo) — @human-ab44e6c8
   修改 Orchestrator 消息处理逻辑，支持解析跨阶段的 @mention。引入 Agent 级别的 suspended 状态，实现活跃 Agent 的平滑切换。

2. **PM Agent: 支持非初始阶段的增量需求更新** (todo) — @human-ab44e6c8
   调整 PM Agent 的 System Prompt 和处理逻辑，使其在已有 PRD 的情况下被唤醒时，能基于现有内容进行 diff 更新，并重新触发审批卡点。

3. **Dev Agent: 恢复执行时的上下文热加载** (todo) — @human-ab44e6c8
   在 Dev Agent SDK 中增加 resume 时的上下文校验机制，确保其能读取到最新的 context.prd 和 context.tasks。

4. **Web UI: 弱化阶段展示与 Mention 交互优化** (todo) — @human-ab44e6c8
   在前端群聊界面中，弱化顶部严格的 Phase 进度条，增强输入框的 @ 提及补全提示，并在消息流中清晰展示 Agent 的介入与退出状态。