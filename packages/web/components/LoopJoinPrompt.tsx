'use client';

import { useState, type FormEvent } from 'react';
import type { UserIdentity } from '../lib/user-identity';

interface LoopJoinPromptProps {
  loopId: string;
  user: UserIdentity;
  orchestratorUrl: string;
  onJoined: () => void;
}

export function LoopJoinPrompt({
  loopId,
  user,
  orchestratorUrl,
  onJoined,
}: LoopJoinPromptProps) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${orchestratorUrl}/api/loops/${loopId}/members/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.userId,
          displayName: displayName.trim(),
          bio: bio.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `加入失败 (${res.status})`);
      }
      onJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(1, 4, 9, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 24,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%',
          maxWidth: 480,
          padding: 24,
          borderRadius: 12,
          border: '1px solid #30363d',
          background: '#161b22',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>加入本 Loop</h2>
        <p style={{ margin: '0 0 16px', color: '#8b949e', fontSize: 14, lineHeight: 1.5 }}>
          加入后才能发言和被 Agent @。专长描述可选——<strong style={{ color: '#e6edf3' }}>留空表示各类问题都可以找你</strong>。
        </p>
        <label style={{ display: 'block', fontSize: 13, color: '#8b949e', marginBottom: 6 }}>
          昵称
        </label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={32}
          required
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid #30363d',
            background: '#0d1117',
            color: '#e6edf3',
            marginBottom: 12,
          }}
        />
        <label style={{ display: 'block', fontSize: 13, color: '#8b949e', marginBottom: 6 }}>
          专长 / 职责（可选）
        </label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="例如：负责 K8s 部署和 MySQL；或产品决策"
          rows={4}
          maxLength={500}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid #30363d',
            background: '#0d1117',
            color: '#e6edf3',
            marginBottom: 12,
            resize: 'vertical',
          }}
        />
        {error && (
          <p style={{ color: '#f85149', fontSize: 13, margin: '0 0 12px' }}>{error}</p>
        )}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '10px 16px',
            borderRadius: 8,
            border: 'none',
            background: '#238636',
            color: '#fff',
            fontWeight: 600,
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? '加入中…' : '加入并进入群聊'}
        </button>
      </form>
    </div>
  );
}
