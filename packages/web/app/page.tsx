'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ORCHESTRATOR =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:3000';

export default function HomePage() {
  const router = useRouter();
  const [title, setTitle] = useState('新功能 Loop');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function createLoop() {
    setLoading(true);
    setError('');
    try {
      const projectRes = await fetch(`${ORCHESTRATOR}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'default' }),
      });
      const project = await projectRes.json();

      const loopRes = await fetch(
        `${ORCHESTRATOR}/api/projects/${project.id}/loops`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        },
      );
      const loop = await loopRes.json();
      router.push(`/loop/${loop.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 560, margin: '80px auto', padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>AI Native Loop</h1>
      <p style={{ color: '#8b949e', marginBottom: 24 }}>
        群聊协作：PM → Dev → Ops 完整迭代
      </p>
      <label style={{ display: 'block', marginBottom: 8 }}>Loop 标题</label>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid #30363d',
          background: '#161b22',
          color: '#e6edf3',
          marginBottom: 16,
        }}
      />
      <button
        onClick={createLoop}
        disabled={loading}
        style={{
          padding: '10px 20px',
          borderRadius: 8,
          border: 'none',
          background: '#238636',
          color: '#fff',
          fontWeight: 600,
        }}
      >
        {loading ? '创建中…' : '创建并进入群聊'}
      </button>
      {error && <p style={{ color: '#f85149', marginTop: 12 }}>{error}</p>}
    </main>
  );
}
