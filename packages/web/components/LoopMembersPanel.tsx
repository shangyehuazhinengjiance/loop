'use client';

import { useCallback, useEffect, useState } from 'react';
import type { UserIdentity } from '../lib/user-identity';

interface LoopMember {
  userId: string;
  displayName: string;
  bio: string;
}

interface LoopMembersPanelProps {
  loopId: string;
  user: UserIdentity;
  orchestratorUrl: string;
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

export function LoopMembersPanel({
  loopId,
  user,
  orchestratorUrl,
  open,
  onClose,
  onUpdated,
}: LoopMembersPanelProps) {
  const [members, setMembers] = useState<LoopMember[]>([]);
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const list = (await fetch(`${orchestratorUrl}/api/loops/${loopId}/members`).then(
      (r) => r.json(),
    )) as LoopMember[];
    setMembers(list);
    const me = list.find((m) => m.userId === user.userId);
    setBio(me?.bio ?? '');
  }, [loopId, orchestratorUrl, user.userId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function saveBio() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${orchestratorUrl}/api/loops/${loopId}/members/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId, bio }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      await load();
      onUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 12,
          padding: 24,
          width: 'min(480px, 92vw)',
          maxHeight: '80vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <strong>Loop 成员</strong>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8b949e',
              cursor: 'pointer',
              fontSize: 18,
            }}
          >
            ×
          </button>
        </div>

        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px' }}>
          {members.map((m) => (
            <li
              key={m.userId}
              style={{
                padding: '10px 0',
                borderBottom: '1px solid #21262d',
                fontSize: 14,
              }}
            >
              <div>
                <span style={{ color: '#58a6ff' }}>@{m.userId}</span>{' '}
                <strong>{m.displayName}</strong>
                {m.userId === user.userId && (
                  <span style={{ color: '#8b949e', fontSize: 12, marginLeft: 6 }}>（我）</span>
                )}
              </div>
              <div style={{ color: '#8b949e', marginTop: 4, fontSize: 13 }}>
                {m.bio.trim() || '（未填写专长，各类问题均可联系）'}
              </div>
            </li>
          ))}
          {members.length === 0 && (
            <li style={{ color: '#8b949e', fontSize: 14 }}>暂无成员</li>
          )}
        </ul>

        <div style={{ fontSize: 13, marginBottom: 8, color: '#8b949e' }}>
          我的专长（bio，用于 Agent 自动匹配 @）
        </div>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="例如：K8s、MySQL、产品评审"
          rows={3}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: 10,
            borderRadius: 8,
            border: '1px solid #30363d',
            background: '#0d1117',
            color: '#e6edf3',
            resize: 'vertical',
          }}
        />
        {error && (
          <div style={{ color: '#f85149', fontSize: 13, marginTop: 8 }}>{error}</div>
        )}
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveBio()}
          style={{
            marginTop: 12,
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            background: '#238636',
            color: '#fff',
            cursor: saving ? 'wait' : 'pointer',
          }}
        >
          {saving ? '保存中…' : '保存专长'}
        </button>
      </div>
    </div>
  );
}
