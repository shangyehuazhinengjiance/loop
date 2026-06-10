'use client';

import Link from 'next/link';
import { MarkdownContent } from '../../../../components/MarkdownContent';
import { useEffect, useState } from 'react';

const ORCHESTRATOR =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:3000';

export default function ReplayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [loopId, setLoopId] = useState('');
  const [targetPhase, setTargetPhase] = useState('requirement');
  const [data, setData] = useState<{
    messages: { sender: { displayName: string }; content: { body: string }; phase: string }[];
    artifacts: { type: string; name: string; version: number }[];
    phaseHistory: { fromPhase: string | null; toPhase: string; trigger: string }[];
  } | null>(null);

  useEffect(() => {
    params.then((p) => setLoopId(p.id));
  }, [params]);

  useEffect(() => {
    if (!loopId) return;
    fetch(`${ORCHESTRATOR}/api/loops/${loopId}/replay?targetPhase=${targetPhase}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [loopId, targetPhase]);

  if (!loopId) return null;

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <Link href={`/loop/${loopId}`} style={{ fontSize: 14 }}>
        ← 返回群聊
      </Link>
      <h1 style={{ marginTop: 16 }}>Loop 历史回放</h1>
      <p style={{ color: '#8b949e' }}>Loop: {loopId}</p>

      <label style={{ display: 'block', marginTop: 16, marginBottom: 8 }}>
        回放截止阶段
      </label>
      <select
        value={targetPhase}
        onChange={(e) => setTargetPhase(e.target.value)}
        style={{
          padding: '8px 12px',
          borderRadius: 8,
          background: '#161b22',
          color: '#e6edf3',
          border: '1px solid #30363d',
        }}
      >
        <option value="requirement">requirement</option>
        <option value="development">development</option>
        <option value="deployment">deployment</option>
        <option value="done">done</option>
      </select>

      {data && (
        <>
          <h2 style={{ marginTop: 32 }}>阶段流转</h2>
          <ul style={{ color: '#8b949e' }}>
            {data.phaseHistory.map((t, i) => (
              <li key={i}>
                {t.fromPhase ?? '∅'} → {t.toPhase} ({t.trigger})
              </li>
            ))}
          </ul>

          <h2 style={{ marginTop: 24 }}>Artifacts ({data.artifacts.length})</h2>
          <ul>
            {data.artifacts.map((a, i) => (
              <li key={i}>
                {a.type} / {a.name} v{a.version}
              </li>
            ))}
          </ul>

          <h2 style={{ marginTop: 24 }}>消息 ({data.messages.length})</h2>
          {data.messages.map((m, i) => (
            <div
              key={i}
              style={{
                marginBottom: 12,
                padding: 12,
                borderRadius: 8,
                background: '#161b22',
                border: '1px solid #30363d',
              }}
            >
              <div style={{ fontSize: 12, color: '#8b949e' }}>
                {m.sender.displayName} · {m.phase}
              </div>
              <div style={{ marginTop: 4 }}>
                <MarkdownContent content={m.content.body} />
              </div>
            </div>
          ))}
        </>
      )}
    </main>
  );
}
