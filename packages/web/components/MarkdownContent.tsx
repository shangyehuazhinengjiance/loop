'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export type MarkdownVariant = 'default' | 'bubble-self' | 'bubble-other' | 'progress';

interface MarkdownContentProps {
  content: string;
  variant?: MarkdownVariant;
}

export function MarkdownContent({ content, variant = 'default' }: MarkdownContentProps) {
  const className =
    variant === 'default'
      ? 'markdown-body'
      : `markdown-body markdown-body--${variant}`;
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
