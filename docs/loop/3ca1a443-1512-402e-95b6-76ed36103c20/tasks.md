# 任务拆解

1. **顶部信息栏 UI 开发** (todo)
   在 packages/web 的群聊页面顶部 Header 组件中，接入当前 Loop 的 title 和 createdAt 字段，并使用 dayjs/date-fns 将时间格式化为东八区（UTC+8）展示。

2. **消息时间戳功能开发** (todo)
   修改 MessageBubble 组件，解析消息的 timestamp，并统一转换为东八区（UTC+8）时间显示在消息气泡的合适位置。

3. **中间过程消息视觉降噪优化** (todo)
   重构系统消息和 Agent 工具调用（tool_use/Bash/Read等）的展示逻辑。将连续的中间过程消息合并为紧凑的日志流或折叠面板，默认收起详细输出，减少刷屏感。

4. **消息气泡背景色样式调整** (todo)
   修改全局或组件级 CSS/Tailwind 配置，将非当前用户（isSelf === false）的消息气泡背景色从纯白调整为视觉更协调的浅色（如 bg-gray-100），并确保暗黑模式（如有）下的兼容性。