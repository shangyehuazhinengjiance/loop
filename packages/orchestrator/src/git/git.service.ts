import { Injectable } from '@nestjs/common';
import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Phase } from '@loop/shared';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { ProjectRepository } from '../db/repositories/project.repository.js';
import { runCommand } from './exec.js';
import { SecretManager } from './secret-manager.js';

export interface InitWorkspaceResult {
  workspacePath: string;
  gitBranch: string;
  gitRef: string;
}

@Injectable()
export class GitService {
  constructor(
    private readonly secretManager: SecretManager,
    private readonly loopRepo: LoopRepository,
    private readonly projectRepo: ProjectRepository,
  ) {}

  async initLoopWorkspace(loopId: string): Promise<InitWorkspaceResult> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) throw new Error(`Loop not found: ${loopId}`);

    const project = await this.projectRepo.findById(loop.project_id);
    if (!project) throw new Error(`Project not found: ${loop.project_id}`);

    const gitConfig = project.git_config as {
      remoteUrl?: string;
      defaultBranch?: string;
      credentialRef?: string;
    };

    const workspacePath =
      loop.workspace_path ??
      join(process.env.WORKSPACE_ROOT ?? './workspaces', `loop-${loopId}`);

    await mkdir(workspacePath, { recursive: true });

    const remoteUrl = gitConfig.remoteUrl;
    if (!remoteUrl) {
      await this.gitInitEmpty(workspacePath);
      const branch = `loop/${loopId}`;
      await runCommand('git', ['checkout', '-B', branch], { cwd: workspacePath });
      const gitRef = await this.currentRef(workspacePath);
      await this.loopRepo.updateGit(loopId, branch, workspacePath);
      return { workspacePath, gitBranch: branch, gitRef };
    }

    const credentialRef = gitConfig.credentialRef ?? 'GIT_ACCESS_TOKEN';
    const credential = await this.secretManager.get(credentialRef);
    const cloneUrl = this.secretManager.buildAuthenticatedUrl(remoteUrl, credential);
    const gitEnv = this.secretManager.gitEnv(credential);

    const exists = await this.pathExists(join(workspacePath, '.git'));
    if (!exists) {
      await runCommand('git', ['clone', cloneUrl, workspacePath], { env: gitEnv });
    }

    const defaultBranch = gitConfig.defaultBranch ?? 'main';
    const loopBranch = `loop/${loopId}`;

    await runCommand('git', ['checkout', defaultBranch], { cwd: workspacePath, env: gitEnv });
    await runCommand('git', ['checkout', '-B', loopBranch], { cwd: workspacePath, env: gitEnv });

    const gitRef = await this.currentRef(workspacePath);
    await this.loopRepo.updateGit(loopId, loopBranch, workspacePath);

    await this.loopRepo.updateContext(loopId, {
      ...loop.context,
      gitRef,
    });

    return { workspacePath, gitBranch: loopBranch, gitRef };
  }

  /** 清空工作区并重新 clone（用于补配 Git 或修复失败的初始化） */
  async reinitLoopWorkspace(loopId: string): Promise<InitWorkspaceResult> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) throw new Error(`Loop not found: ${loopId}`);

    const workspacePath =
      loop.workspace_path ??
      join(process.env.WORKSPACE_ROOT ?? './workspaces', `loop-${loopId}`);

    if (await this.pathExists(workspacePath)) {
      await rm(workspacePath, { recursive: true, force: true });
    }
    await mkdir(workspacePath, { recursive: true });

    return this.initLoopWorkspace(loopId);
  }

  async createSnapshotTag(
    loopId: string,
    phase: Phase,
    label: string,
  ): Promise<string> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop?.workspace_path) return '';

    const hasGit = await this.pathExists(join(loop.workspace_path, '.git'));
    if (!hasGit) return '';

    const ref = await this.currentRef(loop.workspace_path);
    if (!ref) return '';

    const safeLabel = label.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
    const tag = `snapshot/${phase}-${safeLabel}-${Date.now()}`;
    await runCommand('git', ['tag', tag], { cwd: loop.workspace_path });
    return ref;
  }

  async checkoutRef(loopId: string, gitRef: string): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop?.workspace_path) throw new Error('Workspace not initialized');

    await runCommand('git', ['checkout', gitRef], { cwd: loop.workspace_path });
    const current = await this.currentRef(loop.workspace_path);
    await this.loopRepo.updateContext(loopId, {
      ...loop.context,
      gitRef: current,
      devSessionId: undefined,
      opsSessionId: undefined,
    });
  }

  async getDiff(loopId: string, fromRef: string, toRef?: string): Promise<string> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop?.workspace_path) return '';

    const args = toRef
      ? ['diff', `${fromRef}..${toRef}`]
      : ['diff', fromRef];
    const { stdout } = await runCommand('git', args, { cwd: loop.workspace_path });
    return stdout;
  }

  /**
   * 将当前工作区 HEAD 提交（如有改动）并推送到远程目标分支（默认 test）。
   * 使用 `git push origin HEAD:<targetBranch>`，不切换本地分支。
   */
  async commitAndPushToBranch(
    loopId: string,
    targetBranch: string,
    commitMessage: string,
  ): Promise<{ commitSha: string; hadChanges: boolean }> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop?.workspace_path) {
      throw new Error('工作区未初始化');
    }

    const cwd = loop.workspace_path;
    const hasGit = await this.pathExists(join(cwd, '.git'));
    if (!hasGit) {
      throw new Error('工作区无 Git 仓库');
    }

    const project = await this.projectRepo.findById(loop.project_id);
    const gitConfig = project?.git_config as {
      remoteUrl?: string;
      credentialRef?: string;
    } | undefined;
    if (!gitConfig?.remoteUrl) {
      throw new Error('项目未配置 Git 远程地址');
    }

    const credential = await this.secretManager.get(
      gitConfig.credentialRef ?? 'GIT_ACCESS_TOKEN',
    );
    const gitEnv = this.secretManager.gitEnv(credential);

    await runCommand('git', ['config', 'user.email', 'loop@ai-native.dev'], { cwd });
    await runCommand('git', ['config', 'user.name', 'AI Native Loop'], { cwd });

    const { stdout: status } = await runCommand('git', ['status', '--porcelain'], { cwd });
    let hadChanges = false;
    if (status.trim()) {
      hadChanges = true;
      await runCommand('git', ['add', '-A'], { cwd });
      await runCommand('git', ['commit', '-m', commitMessage], { cwd, env: gitEnv });
    }

    const commitSha = await this.currentRef(cwd);
    if (!commitSha) {
      throw new Error('无法获取当前 commit');
    }

    await runCommand(
      'git',
      ['push', 'origin', `HEAD:${targetBranch}`],
      { cwd, env: gitEnv },
    );

    return { commitSha, hadChanges };
  }

  async pushLoopBranch(loopId: string): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop?.workspace_path || !loop.git_branch) return;

    const project = await this.projectRepo.findById(loop.project_id);
    const gitConfig = project?.git_config as { credentialRef?: string } | undefined;
    const credential = await this.secretManager.get(
      gitConfig?.credentialRef ?? 'GIT_ACCESS_TOKEN',
    );

    await runCommand(
      'git',
      ['push', '-u', 'origin', loop.git_branch],
      { cwd: loop.workspace_path, env: this.secretManager.gitEnv(credential) },
    );
  }

  private async gitInitEmpty(workspacePath: string): Promise<void> {
    await runCommand('git', ['init'], { cwd: workspacePath });
    await runCommand('git', ['config', 'user.email', 'loop@local.dev'], { cwd: workspacePath });
    await runCommand('git', ['config', 'user.name', 'Loop Agent'], { cwd: workspacePath });
    await runCommand('git', ['commit', '--allow-empty', '-m', 'init loop workspace'], {
      cwd: workspacePath,
    });
  }

  private async currentRef(cwd: string): Promise<string> {
    try {
      const { stdout } = await runCommand('git', ['rev-parse', 'HEAD'], { cwd });
      return stdout;
    } catch {
      return '';
    }
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}
