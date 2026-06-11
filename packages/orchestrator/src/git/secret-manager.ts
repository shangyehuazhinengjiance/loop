import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitCredential } from '@loop/shared';
import { Injectable } from '@nestjs/common';

/**
 * 凭证解析：优先环境变量 / Secret Manager 引用，不落库明文。
 * credentialRef 约定：
 *   - env:VAR_NAME          → process.env[VAR_NAME]
 *   - file:/path/to/key     → SSH key 文件路径
 *   - GIT_SSH_KEY_PATH      → 默认 SSH
 *   - GIT_ACCESS_TOKEN      → 默认 Token
 */
@Injectable()
export class SecretManager {
  async get(credentialRef: string): Promise<GitCredential> {
    if (credentialRef.startsWith('env:')) {
      const key = credentialRef.slice(4);
      const value = process.env[key];
      if (!value) throw new Error(`Secret env not set: ${key}`);
      return this.resolveFromEnvKey(key, value);
    }

    if (credentialRef.startsWith('file:')) {
      const path = credentialRef.slice(5);
      await readFile(path, 'utf-8');
      return { type: 'ssh', sshKeyPath: path };
    }

    const wantsSsh =
      credentialRef === 'GIT_SSH_KEY_PATH' || credentialRef.toLowerCase().includes('ssh');
    const wantsToken =
      credentialRef === 'GIT_ACCESS_TOKEN' || credentialRef.toLowerCase().includes('token');

    if (wantsSsh || !wantsToken) {
      const sshPath =
        process.env.GIT_SSH_KEY_PATH ??
        (credentialRef && !wantsToken ? join(process.cwd(), credentialRef) : undefined);
      if (sshPath) {
        try {
          await readFile(sshPath, 'utf-8');
          return { type: 'ssh', sshKeyPath: sshPath };
        } catch {
          if (wantsSsh) {
            throw new Error(
              `SSH key not found at ${sshPath}. Mount Deploy Key and set GIT_SSH_KEY_PATH.`,
            );
          }
        }
      } else if (wantsSsh) {
        throw new Error('GIT_SSH_KEY_PATH is not set');
      }
    }

    const token = process.env.GIT_ACCESS_TOKEN ?? process.env[credentialRef];
    if (token && !token.includes('/') && token.length > 8) {
      return { type: 'token', token };
    }

    throw new Error(`Cannot resolve credential: ${credentialRef}`);
  }

  private resolveFromEnvKey(key: string, value: string): GitCredential {
    if (key.toLowerCase().includes('token') || key === 'GIT_ACCESS_TOKEN') {
      return { type: 'token', token: value };
    }
    return { type: 'ssh', sshKeyPath: value };
  }

  buildAuthenticatedUrl(remoteUrl: string, credential: GitCredential): string {
    if (credential.type === 'token' && credential.token) {
      const url = new URL(remoteUrl.replace(/^git@([^:]+):(.+)$/, 'https://$1/$2'));
      url.username = 'x-access-token';
      url.password = credential.token;
      return url.toString();
    }
    return remoteUrl;
  }

  gitEnv(credential: GitCredential): NodeJS.ProcessEnv {
    if (credential.type === 'ssh' && credential.sshKeyPath) {
      return {
        GIT_SSH_COMMAND: `ssh -i ${credential.sshKeyPath} -o StrictHostKeyChecking=no -o IdentitiesOnly=yes`,
      };
    }
    return {};
  }

  /**
   * MR API 需 Token（SSH Deploy Key 无法调 GitHub/GitLab MR API）。
   * 优先项目 gitConfig.mrCredentialRef，否则 GIT_ACCESS_TOKEN。
   */
  resolveMrApiCredentialRef(gitConfig?: {
    mrCredentialRef?: string;
    credentialRef?: string;
  }): string {
    const explicit = gitConfig?.mrCredentialRef?.trim();
    if (explicit) return explicit;

    const projectRef = gitConfig?.credentialRef?.trim();
    if (
      projectRef &&
      (projectRef === 'GIT_ACCESS_TOKEN' ||
        projectRef.toLowerCase().includes('token') ||
        projectRef.startsWith('env:') && projectRef.toLowerCase().includes('token'))
    ) {
      return projectRef;
    }

    return 'GIT_ACCESS_TOKEN';
  }
}
