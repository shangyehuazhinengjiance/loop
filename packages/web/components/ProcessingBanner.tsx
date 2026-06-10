'use client';

export function ProcessingBanner({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: '10px 20px',
        background: '#132339',
        borderBottom: '1px solid #388bfd66',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 14,
        color: '#e6edf3',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 14,
          height: 14,
          border: '2px solid #388bfd44',
          borderTopColor: '#58a6ff',
          borderRadius: '50%',
          animation: 'loop-spin 0.8s linear infinite',
          flexShrink: 0,
        }}
      />
      <span>{label}</span>
      <style>{`@keyframes loop-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
