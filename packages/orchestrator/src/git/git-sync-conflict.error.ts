/** push/rebase 与远程分支冲突，需人工解决后重试 */
export class GitSyncConflictError extends Error {
  constructor(
    message: string,
    readonly branch: string,
    readonly detail: string,
  ) {
    super(message);
    this.name = 'GitSyncConflictError';
  }
}

export function isGitSyncConflictError(err: unknown): err is GitSyncConflictError {
  return err instanceof GitSyncConflictError;
}
