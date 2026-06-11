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

@Injectable()
export class MergeRequestService {
  constructor(private readonly secretManager: SecretManager) {}

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
