import { Text, View } from 'react-native';

import SectionEyebrow from '../SectionEyebrow';
import { SettingsGroup, SettingsRow, SettingsToggle } from './primitives';
import type { PrivacySettings } from '../../shared/api/user.api';
import type { SecurityDiagnostics } from '../../shared/settings/useSecurityDiagnostics';
import { useBlocksStore } from '../../store/blocks.store';

/** Settings → Privacy: the T7.4 toggles, then blocked and trusted contacts and a short explainer (B4). */
export default function PrivacySection({
  userId,
  privacy,
  privacyError,
  onToggle,
  diagnostics,
  diagnosticsLoading,
  onOpenBlocked,
  onOpenTrusted,
  onOpenVerificationHelp,
}: {
  userId: string | null;
  privacy: PrivacySettings;
  privacyError: string | null;
  onToggle: (key: keyof PrivacySettings, value: boolean) => void | Promise<void>;
  diagnostics: SecurityDiagnostics | null;
  diagnosticsLoading: boolean;
  onOpenBlocked: () => void;
  onOpenTrusted: () => void;
  onOpenVerificationHelp: () => void;
}) {
  const blockedCount = useBlocksStore((s) => (userId ? s.blockedByUser[String(userId)] : undefined)?.length ?? 0);

  return (
    <>
      <SectionEyebrow title="Privacy" />
      <SettingsGroup>
        <SettingsRow
          title="Show when I'm online"
          subtitle="Off by default: contacts never see a live presence unless you allow it."
          onPress={() => onToggle('online', !privacy.online)}
          trailing={<SettingsToggle value={privacy.online} onValueChange={(v) => onToggle('online', v)} />}
        />
        <SettingsRow
          title="Show last seen"
          subtitle="Off by default: contacts see nothing about when you were last here."
          onPress={() => onToggle('lastSeen', !privacy.lastSeen)}
          trailing={<SettingsToggle value={privacy.lastSeen} onValueChange={(v) => onToggle('lastSeen', v)} />}
        />
        <SettingsRow
          title="Send read receipts"
          subtitle="Tell senders when you have read their messages. Your own unread counts are unaffected."
          onPress={() => onToggle('readReceipts', !privacy.readReceipts)}
          trailing={<SettingsToggle value={privacy.readReceipts} onValueChange={(v) => onToggle('readReceipts', v)} />}
        />
        <SettingsRow
          title="Show typing"
          subtitle="Let the other side see when you are typing."
          onPress={() => onToggle('typing', !privacy.typing)}
          trailing={<SettingsToggle value={privacy.typing} onValueChange={(v) => onToggle('typing', v)} />}
          last={!privacyError}
        />
        {privacyError ? (
          <View className="px-4 pb-3">
            <Text className="text-xs text-danger">{privacyError}</Text>
          </View>
        ) : null}
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow
          title="Blocked contacts"
          subtitle="They cannot message you, see your presence or typing, or reach you in groups."
          value={String(blockedCount)}
          onPress={onOpenBlocked}
        />
        <SettingsRow
          title="Trusted contacts"
          subtitle="Contacts you verified on this phone."
          value={diagnosticsLoading ? 'Checking' : `${diagnostics?.trustedContactsCount ?? 0}`}
          onPress={onOpenTrusted}
        />
        <SettingsRow
          title="How verification works"
          onPress={onOpenVerificationHelp}
          last
        />
      </SettingsGroup>
    </>
  );
}
