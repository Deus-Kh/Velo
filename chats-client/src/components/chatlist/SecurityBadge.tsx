import StatusChip from '../StatusChip';

/** Whether a contact can receive encrypted messages yet. */
export default function SecurityBadge({ ready, label }: { ready: boolean; label: string }) {
  return <StatusChip label={label} tone={ready ? 'primary' : 'warning'} />;
}
