interface EmptyStateProps {
  emoji: string;
  title: string;
  desc?: string;
}

export default function EmptyState({ emoji, title, desc }: EmptyStateProps) {
  return (
    <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>{emoji}</div>
      <div style={{ fontSize: 14, marginBottom: 4 }}>{title}</div>
      {desc && <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{desc}</div>}
    </div>
  );
}
