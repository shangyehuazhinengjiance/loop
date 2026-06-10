'use client';

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';

const MENTION_OPTIONS = [
  { mention: '@pm-agent', label: 'PM Agent', desc: '需求与方案' },
  { mention: '@dev-agent', label: 'Dev Agent', desc: '开发与实现' },
  { mention: '@ops-agent', label: 'Ops Agent', desc: '部署与运维' },
] as const;

interface MentionState {
  atIndex: number;
  query: string;
  cursor: number;
}

function getMentionState(value: string, cursor: number): MentionState | null {
  const before = value.slice(0, cursor);
  const atIndex = before.lastIndexOf('@');
  if (atIndex === -1) return null;
  if (atIndex > 0 && !/\s/.test(before[atIndex - 1]!)) return null;

  const query = before.slice(atIndex + 1);
  if (/[\s\n]/.test(query)) return null;

  return { atIndex, query, cursor };
}

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
}

export function ChatInput({ value, onChange, onSend, disabled }: ChatInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = mention
    ? MENTION_OPTIONS.filter(
        (opt) =>
          opt.mention.slice(1).toLowerCase().includes(mention.query.toLowerCase()) ||
          opt.label.toLowerCase().includes(mention.query.toLowerCase()),
      )
    : [];

  const syncMention = useCallback((text: string, cursor: number) => {
    const state = getMentionState(text, cursor);
    setMention(state);
    setActiveIndex(0);
  }, []);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    onChange(next);
    syncMention(next, e.target.selectionStart ?? next.length);
  }

  function insertMention(mentionText: string) {
    if (!mention || !inputRef.current) return;
    const before = value.slice(0, mention.atIndex);
    const after = value.slice(mention.cursor);
    const next = `${before}${mentionText} ${after}`;
    const cursor = before.length + mentionText.length + 1;
    onChange(next);
    setMention(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (mention && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filtered[activeIndex]!.mention);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      {mention && filtered.length > 0 && (
        <ul
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            margin: '0 0 8px',
            padding: 4,
            listStyle: 'none',
            borderRadius: 8,
            border: '1px solid #30363d',
            background: '#161b22',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            maxHeight: 160,
            overflow: 'auto',
            zIndex: 10,
          }}
        >
          {filtered.map((opt, idx) => (
            <li key={opt.mention}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(opt.mention);
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  background: idx === activeIndex ? '#21262d' : 'transparent',
                  color: '#e6edf3',
                }}
              >
                <span style={{ color: '#58a6ff', fontWeight: 500 }}>{opt.mention}</span>
                <span style={{ color: '#8b949e', marginLeft: 8, fontSize: 13 }}>
                  {opt.desc}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        value={value}
        disabled={disabled}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={(e) =>
          syncMention(value, (e.target as HTMLInputElement).selectionStart ?? value.length)
        }
        onKeyUp={(e) =>
          syncMention(value, (e.target as HTMLInputElement).selectionStart ?? value.length)
        }
        placeholder="输入消息… 输入 @ 提及 Agent"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid #30363d',
          background: '#0d1117',
          color: '#e6edf3',
        }}
      />
    </div>
  );
}
