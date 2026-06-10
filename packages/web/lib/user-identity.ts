export interface UserIdentity {
  userId: string;
  displayName: string;
}

const ID_KEY = 'loop_user_id';
const NAME_KEY = 'loop_user_name';

/** HTTP 等非安全上下文中 randomUUID 不可用，需降级 */
function randomIdSuffix(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().slice(0, 8);
    }
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(4);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(-8);
}

export function loadUserIdentity(): UserIdentity | null {
  if (typeof window === 'undefined') return null;
  const userId = localStorage.getItem(ID_KEY);
  const displayName = localStorage.getItem(NAME_KEY);
  if (!userId || !displayName?.trim()) return null;
  return { userId, displayName: displayName.trim() };
}

/** 首次设置或更新昵称；userId 只在首次生成，之后保持不变 */
export function saveUserIdentity(displayName: string): UserIdentity {
  const trimmed = displayName.trim();
  if (!trimmed) {
    throw new Error('昵称不能为空');
  }

  let userId = localStorage.getItem(ID_KEY);
  if (!userId) {
    userId = `human-${randomIdSuffix()}`;
    localStorage.setItem(ID_KEY, userId);
  }
  localStorage.setItem(NAME_KEY, trimmed);
  return { userId, displayName: trimmed };
}
