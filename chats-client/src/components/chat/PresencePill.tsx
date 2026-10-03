import StatusChip from '../StatusChip';
import type { HeaderPresenceMeta } from '../../shared/chat/presence';

/** The chip under the chat header's subtitle for a non-default presence state. */
export default function PresencePill({ label, tone }: { label: string; tone: HeaderPresenceMeta['pillTone'] }) {
  return <StatusChip label={label} tone={tone === 'warning' ? 'warning' : tone === 'offline' ? 'neutral' : 'primary'} />;
}
