export function summarizeOpenAIResponse(data: unknown): string {
  const d = data as {
    choices?: {
      finish_reason?: string;
      message?: {
        content?: string | null;
        tool_calls?: { function?: { name?: string } }[];
      };
    }[];
    error?: { message?: string };
  };
  const choice = d.choices?.[0];
  const msg = choice?.message;
  return JSON.stringify(
    {
      finish_reason: choice?.finish_reason,
      content_length: msg?.content?.length ?? 0,
      content_preview: msg?.content?.slice(0, 120) ?? null,
      tool_calls: msg?.tool_calls?.map((t) => t.function?.name),
      error: d.error?.message,
    },
    null,
    2,
  );
}

/** 无实质内容的占位回复，不应作为成功 artifact */
export function isMeaninglessOpsResult(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return (
    t === '部署准备完成' ||
    t === '已达到最大工具轮次。' ||
    t === '已达到最大工具轮次，请检查工作区改动。'
  );
}
