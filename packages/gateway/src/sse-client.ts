/**
 * Node 环境无全局 EventSource，用 fetch 消费 Orchestrator SSE。
 * 断线后自动重连。
 */
export function subscribeSse(
  url: string,
  onData: (data: string) => void,
  onError?: (err: Error) => void,
): () => void {
  const ac = new AbortController();
  let closed = false;

  const run = async () => {
    while (!closed) {
      try {
        const res = await fetch(url, {
          headers: { Accept: 'text/event-stream' },
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`SSE HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const chunk = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            for (const line of chunk.split('\n')) {
              if (line.startsWith('data:')) {
                onData(line.slice(5).trimStart());
              }
            }
            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch (err) {
        if (closed || ac.signal.aborted) return;
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
        await sleep(2000);
      }
    }
  };

  void run();

  return () => {
    closed = true;
    ac.abort();
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
