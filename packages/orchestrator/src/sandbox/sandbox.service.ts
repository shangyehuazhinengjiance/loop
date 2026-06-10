import { Injectable } from '@nestjs/common';
import { resolve } from 'node:path';

const BLOCKED_COMMANDS = [
  /rm\s+-rf\s+\//,
  /mkfs/,
  /dd\s+if=/,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
  /curl\s+.*\|\s*sh/,
  /wget\s+.*\|\s*sh/,
];

const SENSITIVE_FILES = [
  /\.env$/,
  /id_rsa$/,
  /\.pem$/,
  /credentials\.json$/,
];

export interface SandboxCheckResult {
  allowed: boolean;
  reason?: string;
}

@Injectable()
export class SandboxService {
  isDockerMode(): boolean {
    return process.env.SANDBOX_MODE === 'docker';
  }

  validateWorkspacePath(loopWorkspace: string, targetPath: string): SandboxCheckResult {
    const ws = resolve(loopWorkspace);
    const target = resolve(targetPath);
    if (!target.startsWith(ws)) {
      return { allowed: false, reason: `Path outside workspace: ${targetPath}` };
    }
    return { allowed: true };
  }

  validateBashCommand(command: string): SandboxCheckResult {
    for (const pattern of BLOCKED_COMMANDS) {
      if (pattern.test(command)) {
        return { allowed: false, reason: `Blocked command pattern: ${pattern}` };
      }
    }
    return { allowed: true };
  }

  validateFileWrite(filePath: string): SandboxCheckResult {
    for (const pattern of SENSITIVE_FILES) {
      if (pattern.test(filePath)) {
        return { allowed: false, reason: `Sensitive file blocked: ${filePath}` };
      }
    }
    return { allowed: true };
  }

  dockerRunArgs(workspacePath: string): string[] {
    if (!this.isDockerMode()) return [];
    return [
      'run', '--rm',
      '-v', `${resolve(workspacePath)}:/workspace`,
      '-w', '/workspace',
      process.env.SANDBOX_IMAGE ?? 'node:20-bookworm',
    ];
  }
}
