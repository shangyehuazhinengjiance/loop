import {
  failureMentions,
  LOOP_DOT_DESIGN,
  LOOP_DOT_DIR,
  LOOP_DOT_FILES,
  LOOP_DOT_HISTORY,
  LOOP_DOT_MEMORY,
  LOOP_DOT_README,
  loopDotBundleToPrompt,
  pickNotifyMember,
  testBranch,
  type LoopDotLoopBundle,
  type ProjectModelConfig,
} from '@loop/shared';
import { Injectable } from '@nestjs/common';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ChatService } from '../chat/chat.service.js';
import { LoopProgressService } from '../chat/loop-progress.service.js';
import { LoopMemberRepository } from '../db/repositories/loop-member.repository.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { ProjectRepository } from '../db/repositories/project.repository.js';
import { GitService } from '../git/git.service.js';
import { MergeRequestService } from '../git/merge-request.service.js';
import { SecretManager } from '../git/secret-manager.js';
import { ModelRouter } from '../model/model-router.js';
import { generateUpdatedLoopDotFiles } from './loop-dot-loop-llm.js';

const DEFAULT_README = `# 项目说明

本文件由 Loop 维护，记录项目整体介绍。完成 Loop 并验证上线后会自动更新。
`;

const DEFAULT_DESIGN = `# 技术架构

本文件由 Loop 维护，记录项目技术架构。完成 Loop 并验证上线后会自动更新。
`;

const DEFAULT_HISTORY = `# 历史脉络

本文件由 Loop 以有损压缩方式维护，保留跨 Loop 的关键决策与结论。
`;

const DEFAULT_MEMORY = `# 用户偏好与重要信息

本文件由 Loop 以有损压缩方式维护，记录用户偏好与需长期记住的约束。
`;

@Injectable()
export class LoopDotLoopService {
  constructor(
    private readonly loopRepo: LoopRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly memberRepo: LoopMemberRepository,
    private readonly chatService: ChatService,
    private readonly progress: LoopProgressService,
    private readonly gitService: GitService,
    private readonly mergeRequestService: MergeRequestService,
    private readonly secretManager: SecretManager,
    private readonly modelRouter: ModelRouter,
  ) {}

  isEnabled(): boolean {
    return process.env.LOOP_DOT_LOOP_ENABLED !== 'false';
  }

  async readFromWorkspace(workspacePath: string): Promise<LoopDotLoopBundle> {
    const readOne = async (rel: string, fallback: string) => {
      try {
        await access(join(workspacePath, rel));
        const raw = await readFile(join(workspacePath, rel), 'utf-8');
        return raw.replace(/^<!--[\s\S]*?-->\n*/gm, '').trim() || fallback;
      } catch {
        return fallback;
      }
    };

    const readme = await readOne(LOOP_DOT_README, DEFAULT_README);
    const design = await readOne(LOOP_DOT_DESIGN, DEFAULT_DESIGN);
    const history = await readOne(LOOP_DOT_HISTORY, DEFAULT_HISTORY);
    const memory = await readOne(LOOP_DOT_MEMORY, DEFAULT_MEMORY);

    const existing: LoopDotLoopBundle['existing'] = {};
    for (const [key, rel] of [
      ['readme', LOOP_DOT_README],
      ['design', LOOP_DOT_DESIGN],
      ['history', LOOP_DOT_HISTORY],
      ['memory', LOOP_DOT_MEMORY],
    ] as const) {
      try {
        await access(join(workspacePath, rel));
        existing[key] = true;
      } catch {
        existing[key] = false;
      }
    }

    return { readme, design, history, memory, existing };
  }

  async readForLoop(loopId: string): Promise<LoopDotLoopBundle | null> {
    if (!this.isEnabled()) return null;
    const loop = await this.loopRepo.findById(loopId);
    if (!loop?.workspace_path) return null;
    return this.readFromWorkspace(loop.workspace_path);
  }

  formatForPmPrompt(bundle: LoopDotLoopBundle): string {
    return loopDotBundleToPrompt(bundle);
  }

  /** Loop 完成（线上验证通过）后：更新 .loop、提交、创建 MR */
  async finalizeOnLoopComplete(
    loopId: string,
    completedBy?: string,
  ): Promise<void> {
    if (!this.isEnabled()) return;

    const loop = await this.loopRepo.findById(loopId);
    if (!loop?.workspace_path) return;

    const project = await this.projectRepo.findById(loop.project_id);
    if (!project) return;

    const gitConfig = project.git_config as { remoteUrl?: string } | undefined;
    if (!gitConfig?.remoteUrl) {
      await this.chatService.publishAgentMessage({
        loopId,
        phase: 'done',
        agentId: 'orchestrator',
        content: {
          type: 'text',
          body: '未配置 Git 远程仓库，已跳过 `.loop` 知识库更新与 MR。',
        },
      });
      return;
    }

    this.chatService.emitProcessing({
      loopId,
      active: true,
      label: '正在更新 .loop 项目知识库…',
    });

    try {
      await this.progress.publish({
        loopId,
        phase: 'done',
        label: '正在读取当前 .loop 知识库…',
        detail: LOOP_DOT_FILES.map((f) => `\`${f}\``).join('、'),
      });

      const existing = await this.readFromWorkspace(loop.workspace_path);
      const messages = await this.chatService.listMessages(loopId);
      const chatExcerpt = messages
        .filter((m) => m.sender.type === 'human')
        .slice(-30)
        .map((m) => `${m.sender.displayName}: ${m.content.body.slice(0, 500)}`)
        .join('\n');

      const model = this.modelRouter.resolve(
        project.model_config as ProjectModelConfig,
        undefined,
        'pm',
      );

      await this.progress.publish({
        loopId,
        phase: 'done',
        label: '正在调用大模型更新 .loop 文件…',
      });

      const updated = await generateUpdatedLoopDotFiles({
        projectName: project.name,
        loopId,
        loopTitle: loop.title,
        context: loop.context,
        chatExcerpt,
        existing,
        model,
      });

      await mkdir(join(loop.workspace_path, LOOP_DOT_DIR), { recursive: true });
      const header = (file: string) =>
        [
          '<!-- AUTO-UPDATED BY LOOP ORCHESTRATOR -->',
          `<!-- loop: ${loopId} -->`,
          `<!-- updatedAt: ${new Date().toISOString()} -->`,
          '',
        ].join('\n');

      const writes: [string, string][] = [
        [LOOP_DOT_README, updated.readme],
        [LOOP_DOT_DESIGN, updated.design],
        [LOOP_DOT_HISTORY, updated.history],
        [LOOP_DOT_MEMORY, updated.memory],
      ];

      for (const [rel, body] of writes) {
        await this.progress.publish({
          loopId,
          phase: 'done',
          label: `正在写入 ${rel}…`,
          updateBanner: false,
        });
        await writeFile(
          join(loop.workspace_path, rel),
          `${header(rel)}${body.trim()}\n`,
          'utf-8',
        );
      }

      await this.progress.publish({
        loopId,
        phase: 'done',
        label: '正在提交到 Git…',
        detail: `分支：\`${loop.git_branch ?? `loop/${loopId}`}\``,
      });

      await this.gitService.commitWorkspace(
        loopId,
        `loop ${loopId}: update .loop project knowledge`,
      );
      await this.gitService.pushLoopBranch(loopId);

      const members = await this.memberRepo.listByLoop(loopId);
      const mergeAssignee = pickNotifyMember(members, {
        preferUserId: completedBy,
        skillsHint:
          process.env.DEPLOY_MERGE_SKILLS ?? '运维 合并 MR 代码评审',
      });

      const headBranch = loop.git_branch ?? `loop/${loopId}`;
      const baseBranch = testBranch();
      const mrCredentialRef = this.secretManager.resolveMrApiCredentialRef(
        gitConfig as { mrCredentialRef?: string },
      );

      await this.progress.publish({
        loopId,
        phase: 'done',
        label: '正在创建 .loop 知识库合并 MR…',
        detail: `\`${headBranch}\` → \`${baseBranch}\``,
      });

      const mr = await this.mergeRequestService.createOrGetMergeRequest({
        remoteUrl: String(gitConfig.remoteUrl),
        credentialRef: mrCredentialRef,
        headBranch,
        baseBranch,
        title: `loop ${loopId}: update .loop knowledge`,
        body: [
          '## .loop 项目知识库更新',
          '',
          `- Loop：\`${loopId}\` — ${loop.title}`,
          `- 已更新：\`${LOOP_DOT_README}\`、\`${LOOP_DOT_DESIGN}\`、\`${LOOP_DOT_HISTORY}\`、\`${LOOP_DOT_MEMORY}\``,
          '',
          '请在 Git 平台 Review 并合并，使后续 Loop 的 PM Agent 能读取最新项目上下文。',
        ].join('\n'),
      });

      const mention = mergeAssignee
        ? `@${mergeAssignee.userId}（${mergeAssignee.displayName}）`
        : '相关同事';

      await this.chatService.publishAgentMessage({
        loopId,
        phase: 'done',
        agentId: 'orchestrator',
        content: {
          type: 'artifact',
          body: [
            '## .loop 项目知识库已更新',
            '',
            '本 Loop 线上验证已通过，已更新仓库中的项目知识库文件：',
            '',
            ...LOOP_DOT_FILES.map((f) => `- \`${f}\``),
            '',
            `- MR：[${mr.provider === 'gitlab' ? '!' : '#'}${mr.number}](${mr.url})`,
            `- 分支：\`${headBranch}\` → \`${baseBranch}\``,
            '',
            `请 ${mention} **Review 并合并** 该 MR，以便下一个 Loop 的 PM Agent 读取最新 \`.loop\` 上下文。`,
          ].join('\n'),
          mentions: mergeAssignee ? failureMentions(mergeAssignee) : undefined,
        },
      });
    } catch (err) {
      console.warn(`[loop-dot-loop] finalize failed for ${loopId}:`, err);
      const msg = err instanceof Error ? err.message : String(err);
      await this.chatService.publishAgentMessage({
        loopId,
        phase: 'done',
        agentId: 'orchestrator',
        content: {
          type: 'text',
          body: `**.loop 知识库更新失败**（${msg}）。Loop 已完成，可人工维护 \`.loop/\` 下四个文件后提交。`,
        },
      });
    } finally {
      this.chatService.emitProcessing({ loopId, active: false });
    }
  }
}
