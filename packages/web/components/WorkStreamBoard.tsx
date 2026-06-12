'use client';

import { useCallback, useEffect, useState } from 'react';

const ORCHESTRATOR =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:3000';

interface Run {
  id: string;
  instanceId: string;
  templateId: string;
  templateName?: string;
  version: number;
  status: string;
  owner: { kind: string; id: string; displayName: string };
  blockedReason?: string;
}

interface BoardItem {
  instanceId: string;
  title: string;
  templateId: string;
  templateName: string;
  latestRun: Run;
}

interface BoardData {
  columns: Record<string, BoardItem[]>;
  stats: Record<string, number>;
}

const COLUMN_LABELS: Record<string, string> = {
  active: '进行中',
  ready: '等待',
  blocked: '阻塞',
  done: '已完成',
  other: '其他',
};

export function WorkStreamBoard({ loopId }: { loopId: string }) {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [boardRes, tplRes] = await Promise.all([
        fetch(`${ORCHESTRATOR}/api/loops/${loopId}/workstreams/board`),
        fetch(`${ORCHESTRATOR}/api/workstream-templates`),
      ]);
      if (!boardRes.ok) throw new Error('加载看板失败');
      setBoard(await boardRes.json());
      if (tplRes.ok) setTemplates(await tplRes.json());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [loopId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const addStream = async () => {
    if (!selectedTemplate) return;
    const res = await fetch(`${ORCHESTRATOR}/api/loops/${loopId}/workstreams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: selectedTemplate }),
    });
    if (res.ok) {
      await load();
    }
  };

  const startRun = async (instanceId: string) => {
    await fetch(
      `${ORCHESTRATOR}/api/loops/${loopId}/workstreams/${instanceId}/start`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    await load();
  };

  const completeRun = async (runId: string) => {
    await fetch(
      `${ORCHESTRATOR}/api/loops/${loopId}/workstreams/runs/${runId}/complete`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    await load();
  };

  const reopen = async (instanceId: string) => {
    const reason = prompt('重开原因') || '重新执行';
    await fetch(
      `${ORCHESTRATOR}/api/loops/${loopId}/workstreams/${instanceId}/reopen`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      },
    );
    await load();
  };

  if (loading) return <p className="ws-loading">加载看板…</p>;
  if (error) return <p className="ws-error">{error}</p>;
  if (!board) return null;

  return (
    <section className="ws-board">
      <div className="ws-board-header">
        <h2>子任务流看板</h2>
        <div className="ws-board-actions">
          <select
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value)}
          >
            <option value="">添加子任务流…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={addStream} disabled={!selectedTemplate}>
            添加
          </button>
        </div>
      </div>

      <div className="ws-stats">
        {Object.entries(board.stats).map(([k, v]) => (
          <span key={k} className="ws-stat">
            {COLUMN_LABELS[k] ?? k}: {v}
          </span>
        ))}
      </div>

      <div className="ws-columns">
        {(['active', 'ready', 'blocked', 'done'] as const).map((col) => (
          <div key={col} className="ws-column">
            <h3>
              {COLUMN_LABELS[col]} ({board.columns[col]?.length ?? 0})
            </h3>
            <ul>
              {(board.columns[col] ?? []).map((item) => (
                <li key={item.instanceId} className="ws-card">
                  <div className="ws-card-title">{item.title}</div>
                  <div className="ws-card-meta">
                    v{item.latestRun.version} · {item.latestRun.owner.displayName}
                  </div>
                  {item.latestRun.blockedReason && (
                    <div className="ws-blocked">{item.latestRun.blockedReason}</div>
                  )}
                  <div className="ws-card-actions">
                    {item.latestRun.status === 'ready' && (
                      <button type="button" onClick={() => startRun(item.instanceId)}>
                        启动
                      </button>
                    )}
                    {['active', 'ready', 'blocked'].includes(item.latestRun.status) && (
                      <button type="button" onClick={() => completeRun(item.latestRun.id)}>
                        完成
                      </button>
                    )}
                    {item.latestRun.status === 'done' && (
                      <button type="button" onClick={() => reopen(item.instanceId)}>
                        重开
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
