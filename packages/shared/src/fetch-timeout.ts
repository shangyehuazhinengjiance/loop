/** 合并多个 AbortSignal，任一触发则 abort */
export function combineAbortSignals(
  signals: (AbortSignal | null | undefined)[],
): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => s != null);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];

  const controller = new AbortController();
  const onAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(
        active.find((s) => s.aborted)?.reason ?? new Error('aborted'),
      );
    }
  };
  for (const s of active) {
    if (s.aborted) {
      onAbort();
      return controller.signal;
    }
    s.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}

/** 为 fetch 增加超时；与外部 signal 合并 */
export function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const timeoutMs =
    init.timeoutMs ??
    parseInt(process.env.LLM_FETCH_TIMEOUT_MS ?? '180000', 10);
  const { timeoutMs: _drop, signal: outer, ...rest } = init;

  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    timeoutController.abort(
      new Error(`LLM 请求超时（${timeoutMs}ms），请检查模型网关或稍后重试`),
    );
  }, timeoutMs);

  const signal = combineAbortSignals([outer, timeoutController.signal]);

  return fetch(url, {
    ...rest,
    ...(signal ? { signal } : {}),
  }).finally(() => clearTimeout(timer));
}
