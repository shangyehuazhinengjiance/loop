/** 仓库根目录下的 Loop 项目知识库（纳入 Git 版本管理） */
export const LOOP_DOT_DIR = '.loop';

export const LOOP_DOT_README = `${LOOP_DOT_DIR}/README.md`;
export const LOOP_DOT_DESIGN = `${LOOP_DOT_DIR}/DESIGN.md`;
export const LOOP_DOT_HISTORY = `${LOOP_DOT_DIR}/HISTORY.md`;
export const LOOP_DOT_MEMORY = `${LOOP_DOT_DIR}/MEMORY.md`;

export const LOOP_DOT_FILES = [
  LOOP_DOT_README,
  LOOP_DOT_DESIGN,
  LOOP_DOT_HISTORY,
  LOOP_DOT_MEMORY,
] as const;

export type LoopDotFileKey = 'readme' | 'design' | 'history' | 'memory';

export interface LoopDotLoopBundle {
  readme: string;
  design: string;
  history: string;
  memory: string;
  /** 哪些文件在仓库中已存在 */
  existing: Partial<Record<LoopDotFileKey, boolean>>;
}

export function loopDotBundleToPrompt(bundle: LoopDotLoopBundle): string {
  const sections = [
    `### README.md（项目整体介绍）\n${bundle.readme.trim() || '（空）'}`,
    `### DESIGN.md（技术架构）\n${bundle.design.trim() || '（空）'}`,
    `### HISTORY.md（历史对话脉络，有损压缩）\n${bundle.history.trim() || '（空）'}`,
    `### MEMORY.md（用户偏好与重要信息，有损压缩）\n${bundle.memory.trim() || '（空）'}`,
  ];
  return sections.join('\n\n');
}
