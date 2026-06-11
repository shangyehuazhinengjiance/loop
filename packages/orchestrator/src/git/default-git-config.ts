/** 从环境变量读取默认 Git 仓库（K8s ConfigMap 配置，Web 创建 Project 时自动注入） */
export function defaultGitConfigFromEnv(): Record<string, unknown> | undefined {
  const remoteUrl = process.env.GIT_DEFAULT_REMOTE_URL?.trim();
  if (!remoteUrl) return undefined;

  return {
    remoteUrl,
    defaultBranch: process.env.GIT_DEFAULT_BRANCH?.trim() || 'main',
    credentialRef:
      process.env.GIT_DEFAULT_CREDENTIAL_REF?.trim() || 'GIT_SSH_KEY_PATH',
    /** MR/PR API 与 SSH clone 分离，默认读 GIT_ACCESS_TOKEN */
    mrCredentialRef:
      process.env.GIT_MR_CREDENTIAL_REF?.trim() || 'GIT_ACCESS_TOKEN',
  };
}

export function mergeGitConfig(
  fromClient: Record<string, unknown> | undefined,
  fromEnv: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const client = fromClient ?? {};
  if (client.remoteUrl) return client;
  if (fromEnv?.remoteUrl) return { ...fromEnv, ...client };
  return client;
}
