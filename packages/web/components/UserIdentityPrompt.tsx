'use client';

import { useState, type FormEvent } from 'react';
import { saveUserIdentity, type UserIdentity } from '../lib/user-identity';

interface UserIdentityPromptProps {
  onComplete: (identity: UserIdentity) => void;
  onCancel?: () => void;
  initialName?: string;
  title?: string;
}

export function UserIdentityPrompt({
  onComplete,
  onCancel,
  initialName = '',
  title = '设置你的昵称',
}: UserIdentityPromptProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      onComplete(saveUserIdentity(name));
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
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
          maxWidth: 400,
          padding: 24,
          borderRadius: 12,
          border: '1px solid #30363d',
          background: '#161b22',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>{title}</h2>
        <p style={{ margin: '0 0 16px', color: '#8b949e', fontSize: 14 }}>
          昵称会显示在群聊中，保存在本浏览器，其他人可区分不同参与者。
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：张三"
          maxLength={32}
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
        {error && (
          <p style={{ color: '#f85149', fontSize: 13, margin: '0 0 12px' }}>{error}</p>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              style={{
                flex: 1,
                padding: '10px 16px',
                borderRadius: 8,
                border: '1px solid #30363d',
                background: 'transparent',
                color: '#e6edf3',
              }}
            >
              取消
            </button>
          )}
          <button
            type="submit"
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: 8,
              border: 'none',
              background: '#238636',
              color: '#fff',
              fontWeight: 600,
            }}
          >
            {onCancel ? '保存' : '进入群聊'}
          </button>
        </div>
      </form>
    </div>
  );
}
