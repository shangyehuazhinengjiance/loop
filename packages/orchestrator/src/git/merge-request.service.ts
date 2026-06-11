import {
  gitlabProjectPath,
  parseGitRemoteUrl,
  type MergeRequestInfo,
} from '@loop/shared';
import { Injectable } from '@nestjs/common';
import { SecretManager } from './secret-manager.js';

export interface CreateMergeRequestInput {
  remoteUrl: string;
  credentialRef: string;
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string;
}

export interface BranchComparison {
  aheadBy: number;
  behindBy: number;
  identical: boolean;
}

/** Git 平台拒绝创建 MR/PR：源分支相对目标分支无新提交 */
export class NoCommitsBetweenBranchesError extends Error {
  constructor(
    readonly headBranch: string,
    readonly baseBranch: string,
  ) {
    super(`No commits between ${baseBranch} and ${headBranch}`);
    this.name = 'NoCommitsBetweenBranchesError';
  }
}

export function isNoCommitsBetweenBranchesError(err: unknown): boolean {
  if (err instanceof NoCommitsBetweenBranchesError) return true;
  if (!(err instanceof Error)) return false;
  return /no commits between/i.test(err.message);
}

@Injectable()
export class MergeRequestService {
  constructor(private readonly secretManager: SecretManager) {}

  async compareBranches(input: {
    remoteUrl: string;
    credentialRef: string;
    headBranch: string;
    baseBranch: string;
  }): Promise<BranchComparison> {
    const parsed = parseGitRemoteUrl(input.remoteUrl);
    if (!parsed) {
      throw new Error(`无法解析 Git 远程地址: ${input.remoteUrl}`);
    }

    const credential = await this.secretManager.get(input.credentialRef);
    if (credential.type !== 'token' || !credential.token) {
      throw new Error('创建 MR 需要 GIT_ACCESS_TOKEN');
    }

    if (parsed.provider === 'gitlab') {
      return this.compareGitLabBranches(parsed, credential.token, input);
    }

    return this.compareGitHubBranches(parsed, credential.token, input);
  }

  async createOrGetMergeRequest(
    input: CreateMergeRequestInput,
  ): Promise<MergeRequestInfo> {
    const parsed = parseGitRemoteUrl(input.remoteUrl);
    if (!parsed) {
      throw new Error(`无法解析 Git 远程地址: ${input.remoteUrl}`);
    }

    const credential = await this.secretManager.get(input.credentialRef);
    if (credential.type !== 'token' || !credential.token) {
      throw new Error(
        '创建 MR 需要 GIT_ACCESS_TOKEN（或项目 gitConfig.credentialRef 指向的 Token）。SSH Deploy Key 无法调用 MR API。',
      );
    }

    if (parsed.provider === 'gitlab') {
      return this.createOrGetGitLabMr(parsed, credential.token, input);
    }

    if (parsed.provider === 'github' || parsed.provider === 'unknown') {
      return this.createOrGetGitHubPr(parsed, credential.token, input);
    }

    throw new Error(`不支持的 Git 平台: ${parsed.host}`);
  }

  private apiBase(provider: 'github' | 'gitlab', host: string): string {
    if (provider === 'github') {
      return (
        process.env.GITHUB_API_BASE?.replace(/\/$/, '') ??
        (host.includes('github.com')
          ? 'https://api.github.com'
          : `https://${host}/api/v3`)
      );
    }
    return (
      process.env.GITLAB_API_BASE?.replace(/\/$/, '') ??
      (host.includes('gitlab.com')
        ? 'https://gitlab.com/api/v4'
        : `https://${host}/api/v4`)
    );
  }

  private async createOrGetGitHubPr(
    parsed: NonNullable<ReturnType<typeof parseGitRemoteUrl>>,
    token: string,
    input: CreateMergeRequestInput,
  ): Promise<MergeRequestInfo> {
    const base = this.apiBase('github', parsed.host);
    const head = `${parsed.owner}:${input.headBranch}`;
    const listUrl = `${base}/repos/${parsed.owner}/${parsed.repo}/pulls?state=open&head=${encodeURIComponent(head)}&base=${encodeURIComponent(input.baseBranch)}`;

    const existing = await this.fetchJson<Array<{ number: number; html_url: string }>>(
      listUrl,
      token,
      'github',
    );
    if (existing.length > 0) {
      const pr = existing[0]!;
      return {
        url: pr.html_url,
        number: pr.number,
        headBranch: input.headBranch,
        baseBranch: input.baseBranch,
        provider: 'github',
        createdAt: new Date().toISOString(),
      };
    }

    try {
      const created = await this.fetchJson<{ number: number; html_url: string }>(
        `${base}/repos/${parsed.owner}/${parsed.repo}/pulls`,
        token,
        'github',
        {
          method: 'POST',
          body: JSON.stringify({
            title: input.title,
            head: input.headBranch,
            base: input.baseBranch,
            body: input.body,
          }),
        },
      );

      return {
        url: created.html_url,
        number: created.number,
        headBranch: input.headBranch,
        baseBranch: input.baseBranch,
        provider: 'github',
        createdAt: new Date().toISOString(),
      };
    } catch (err) {
      if (isNoCommitsBetweenBranchesError(err)) throw err;
      if (err instanceof Error && /no commits between/i.test(err.message)) {
        throw new NoCommitsBetweenBranchesError(input.headBranch, input.baseBranch);
      }
      throw err;
    }
  }

  private async compareGitHubBranches(
    parsed: NonNullable<ReturnType<typeof parseGitRemoteUrl>>,
    token: string,
    input: { headBranch: string; baseBranch: string },
  ): Promise<BranchComparison> {
    const base = this.apiBase('github', parsed.host);
    const compareRef = `${encodeURIComponent(input.baseBranch)}...${encodeURIComponent(input.headBranch)}`;
    const data = await this.fetchJson<{
      ahead_by?: number;
      behind_by?: number;
      status?: string;
    }>(
      `${base}/repos/${parsed.owner}/${parsed.repo}/compare/${compareRef}`,
      token,
      'github',
    );
    const aheadBy = data.ahead_by ?? 0;
    const behindBy = data.behind_by ?? 0;
    return {
      aheadBy,
      behindBy,
      identical: data.status === 'identical' || (aheadBy === 0 && behindBy === 0),
    };
  }

  private async compareGitLabBranches(
    parsed: NonNullable<ReturnType<typeof parseGitRemoteUrl>>,
    token: string,
    input: { headBranch: string; baseBranch: string },
  ): Promise<BranchComparison> {
    const base = this.apiBase('gitlab', parsed.host);
    const project = gitlabProjectPath(parsed.owner, parsed.repo);
    const data = await this.fetchJson<{
      commits?: unknown[];
      compare_same_ref?: boolean;
    }>(
      `${base}/projects/${project}/repository/compare?from=${encodeURIComponent(input.baseBranch)}&to=${encodeURIComponent(input.headBranch)}`,
      token,
      'gitlab',
    );
    const aheadBy = data.commits?.length ?? 0;
    const identical = Boolean(data.compare_same_ref) || aheadBy === 0;
    return { aheadBy, behindBy: 0, identical };
  }

  private async createOrGetGitLabMr(
    parsed: NonNullable<ReturnType<typeof parseGitRemoteUrl>>,
    token: string,
    input: CreateMergeRequestInput,
  ): Promise<MergeRequestInfo> {
    const base = this.apiBase('gitlab', parsed.host);
    const project = gitlabProjectPath(parsed.owner, parsed.repo);
    const listUrl =
      `${base}/projects/${project}/merge_requests?state=opened` +
      `&source_branch=${encodeURIComponent(input.headBranch)}` +
      `&target_branch=${encodeURIComponent(input.baseBranch)}`;

    const existing = await this.fetchJson<Array<{ iid: number; web_url: string }>>(
      listUrl,
      token,
      'gitlab',
    );
    if (existing.length > 0) {
      const mr = existing[0]!;
      return {
        url: mr.web_url,
        number: mr.iid,
        headBranch: input.headBranch,
        baseBranch: input.baseBranch,
        provider: 'gitlab',
        createdAt: new Date().toISOString(),
      };
    }

    try {
      const created = await this.fetchJson<{ iid: number; web_url: string }>(
        `${base}/projects/${project}/merge_requests`,
        token,
        'gitlab',
        {
          method: 'POST',
          body: JSON.stringify({
            title: input.title,
            source_branch: input.headBranch,
            target_branch: input.baseBranch,
            description: input.body,
          }),
        },
      );

      return {
        url: created.web_url,
        number: created.iid,
        headBranch: input.headBranch,
        baseBranch: input.baseBranch,
        provider: 'gitlab',
        createdAt: new Date().toISOString(),
      };
    } catch (err) {
      if (isNoCommitsBetweenBranchesError(err)) throw err;
      if (err instanceof Error && /no commits between|same ref/i.test(err.message)) {
        throw new NoCommitsBetweenBranchesError(input.headBranch, input.baseBranch);
      }
      throw err;
    }
  }

  private async fetchJson<T>(
    url: string,
    token: string,
    provider: 'github' | 'gitlab',
    init?: RequestInit,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: provider === 'github' ? 'application/vnd.github+json' : 'application/json',
      'Content-Type': 'application/json',
    };
    if (provider === 'github') {
      headers.Authorization = `Bearer ${token}`;
    } else {
      headers['PRIVATE-TOKEN'] = token;
    }

    const res = await fetch(url, { ...init, headers: { ...headers, ...init?.headers } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Git ${provider} API ${res.status}: ${text.slice(0, 500)}`,
      );
    }
    return res.json() as Promise<T>;
  }
}
