import { CODEBASE_SUMMARY_REL_PATH, type LoopContext } from '@loop/shared';

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

## 代码库摘要
工作区根目录有 \`${CODEBASE_SUMMARY_REL_PATH}\`（若存在）。
**开始开发前必须先 Read 该文件**，用它理解项目结构与技术栈，避免盲目 Glob/Grep 全仓库。

## 工作准则
- 严格遵循 PRD 和 tasks
- 优先依据代码库摘要定位文件，再按需 Read 具体源码
- 每次逻辑完成功能后运行测试
- 遇到 PRD 歧义时 @pm-agent 提问，不擅自假设
- 完成后提示人类点击「验收通过」`;
}
