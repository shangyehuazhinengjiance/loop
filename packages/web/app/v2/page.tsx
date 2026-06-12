'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ORCHESTRATOR =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:3000';

export default function HomeV2() {
  const router = useRouter();
  const [projectName, setProjectName] = useState('demo-project');
  const [loopTitle, setLoopTitle] = useState('新迭代');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    setLoading(true);
    setError('');
    try {
      const projectRes = await fetch(`${ORCHESTRATOR}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName, gitConfig: {}, modelConfig: {} }),
      });
      if (!projectRes.ok) throw new Error('创建项目失败');
      const project = await projectRes.json();

      const loopRes = await fetch(`${ORCHESTRATOR}/api/projects/${project.id}/loops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: loopTitle }),
      });
      if (!loopRes.ok) throw new Error('创建 Loop 失败');
      const loop = await loopRes.json();
      router.push(`/v2/loop/${loop.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="v2-home">
      <h1>AI Native Loop v2</h1>
      <p>子任务流驱动的协作 Loop。详细设计见仓库 <code>.loop/DESIGN.md</code>。</p>

      <div className="v2-form">
        <label>
          项目名称
          <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
        </label>
        <label>
          Loop 标题
          <input value={loopTitle} onChange={(e) => setLoopTitle(e.target.value)} />
        </label>
        <button type="button" onClick={create} disabled={loading}>
          {loading ? '创建中…' : '创建并进入 Loop'}
        </button>
        {error && <p className="ws-error">{error}</p>}
      </div>
    </main>
  );
}
