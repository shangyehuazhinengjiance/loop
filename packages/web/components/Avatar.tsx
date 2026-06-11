'use client';

const AGENT_COLORS: Record<string, string> = {
  'pm-agent': '#7c5cff',
  'dev-agent': '#238636',
  'ops-agent': '#d29922',
  orchestrator: '#388bfd',
};

function hashHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) % 360;
  }
  return h;
}

function initials(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export interface AvatarProps {
  displayName: string;
  senderId?: string;
  senderType?: string;
  imageUrl?: string | null;
  size?: number;
}

export function Avatar({
  displayName,
  senderId,
  senderType,
  imageUrl,
  size = 40,
}: AvatarProps) {
  const fontSize = Math.max(12, Math.round(size * 0.36));

  if (imageUrl?.trim()) {
    return (
      <img
        src={imageUrl.trim()}
        alt={displayName}
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          borderRadius: 6,
          objectFit: 'cover',
          flexShrink: 0,
          background: '#30363d',
        }}
      />
    );
  }

  const agentColor = senderId ? AGENT_COLORS[senderId] : undefined;
  const bg =
    agentColor ??
    (senderType === 'agent'
      ? '#484f58'
      : `hsl(${hashHue(senderId ?? displayName)} 45% 42%)`);

  return (
    <div
      aria-hidden
      title={displayName}
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        flexShrink: 0,
        background: bg,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        fontWeight: 600,
        userSelect: 'none',
        letterSpacing: '-0.02em',
      }}
    >
      {initials(displayName)}
    </div>
  );
}
