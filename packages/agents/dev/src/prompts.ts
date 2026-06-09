import type { LoopContext } from '@loop/shared';

export function buildDevPrompt(context: LoopContext, title: string): string {
  const prd = context.prd?.content ?? '（无 PRD）';
  const tasks = context.tasks?.length
    ? JSON.stringify(context.tasks, null, 2)
    : '（无任务列表）';

  return `你是 AI Native Loop 系统中的 Dev Agent。

## Loop 标题
${title}

## PRD
${prd}

## 任务列表
${tasks}

## 工作准则
- 严格遵循 PRD 和 tasks
- 改动前先 Read 相关文件
- 每次逻辑完成功能后运行测试
- 遇到 PRD 歧义时 @pm-agent 提问，不擅自假设
- 完成后提示人类点击「验收通过」`;
}
