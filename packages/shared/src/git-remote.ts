export type GitProvider = 'github' | 'gitlab' | 'unknown';

export interface ParsedGitRemote {
  provider: GitProvider;
  host: string;
  owner: string;
  repo: string;
}

/** 从 git remote URL 解析仓库信息（支持 GitHub / GitLab 常见格式） */
export function parseGitRemoteUrl(remoteUrl: string): ParsedGitRemote | null {
  const ssh = remoteUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (ssh) {
    const [, host, path] = ssh;
    const parts = path.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const repo = parts[parts.length - 1]!.replace(/\.git$/, '');
    const owner = parts.slice(0, -1).join('/');
    return { provider: detectProvider(host), host, owner, repo };
  }

  try {
    const url = new URL(remoteUrl.replace(/\.git$/, ''));
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const repo = parts[parts.length - 1]!;
    const owner = parts.slice(0, -1).join('/');
    return { provider: detectProvider(url.hostname), host: url.hostname, owner, repo };
  } catch {
    return null;
  }
}

function detectProvider(host: string): GitProvider {
  const h = host.toLowerCase();
  if (h.includes('github')) return 'github';
  if (h.includes('gitlab') || h.includes('git.corp')) return 'gitlab';
  return 'unknown';
}

export function gitlabProjectPath(owner: string, repo: string): string {
  return `${owner}/${repo}`.replace(/\//g, '%2F');
}
