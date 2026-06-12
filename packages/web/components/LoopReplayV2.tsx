'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

const ORCHESTRATOR =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:3000';

interface ReplayData {
  messages: { senderType: string; senderId: string; content: { body?: string }; createdAt: string }[];
  workstreamEvents: { eventType: string; createdAt: string; payload: Record<string, unknown> }[];
  runs: { templateId: string; version: number; status: string; summaryTag?: string }[];
}

export function LoopReplayV2({ loopId }: { loopId: string }) {
  const [data, setData] = useState<ReplayData | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${ORCHESTRATOR}/api/loops/${loopId}/replay`);
    if (res.ok) setData(await res.json());
  }, [loopId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="v2-replay">
      <header className="v2-header">
        <h1>Loop 回放</h1>
        <Link href={`/v2/loop/${loopId}`}>← 返回 Loop</Link>
      </header>
      {!data && <p>加载中…</p>}
      {data && (
        <>
          <section>
            <h2>子任务流 Run ({data.runs.length})</h2>
            <ul>
              {data.runs.map((r) => (
                <li key={`${r.templateId}-${r.version}`}>
                  {r.templateId} v{r.version} — {r.status}
                  {r.summaryTag && ` · ${r.summaryTag}`}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2>事件 ({data.workstreamEvents.length})</h2>
            <ul className="v2-replay-events">
              {data.workstreamEvents.map((e, i) => (
                <li key={i}>
                  [{new Date(e.createdAt).toLocaleString()}] {e.eventType}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2>消息 ({data.messages.length})</h2>
            <div className="v2-messages">
              {data.messages.map((m, i) => (
                <div key={i} className="v2-msg">
                  <strong>{m.senderId}</strong>
                  <span>{m.content.body ?? JSON.stringify(m.content)}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
