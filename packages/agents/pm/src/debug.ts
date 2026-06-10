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

export function summarizeAnthropicResponse(response: {
  stop_reason?: string | null;
  model?: string;
  content?: { type: string; text?: string | null; name?: string }[];
}): string {
  return JSON.stringify(
    {
      stop_reason: response.stop_reason,
      model: response.model,
      blocks: response.content?.map((b) => ({
        type: b.type,
        text_len: b.type === 'text' ? (b.text?.length ?? 0) : undefined,
        name: b.type === 'tool_use' ? b.name : undefined,
      })),
    },
    null,
    2,
  );
}
