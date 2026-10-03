import SectionEyebrow from '../SectionEyebrow';
import StatusChip from '../StatusChip';
import { SettingsGroup, SettingsRow } from './primitives';
import type { SecurityDiagnostics } from '../../shared/settings/useSecurityDiagnostics';

/** Settings → Encryption: the keys and sessions on this phone, in plain words. */
export default function EncryptionSection({
  diagnostics,
  diagnosticsLoading,
  keyStateValue,
  encryptionValue,
}: {
  diagnostics: SecurityDiagnostics | null;
  diagnosticsLoading: boolean;
  keyStateValue: string;
  encryptionValue: string;
}) {
  return (
    <>
      <SectionEyebrow
        title="Encryption"
        description="Keys and secure sessions kept on this phone."
      />
      <SettingsGroup>
        <SettingsRow
          title="Your keys"
          subtitle="The keys that identify this account to your contacts."
          trailing={
            <StatusChip
              label={keyStateValue}
              tone={keyStateValue === 'Ready' ? 'success' : 'warning'}
            />
          }
        />
        <SettingsRow
          title="Message protection"
          subtitle="Messages and keys on this phone are stored encrypted."
          trailing={
            <StatusChip
              label={encryptionValue}
              tone={encryptionValue === 'Enabled' ? 'success' : 'warning'}
            />
          }
        />
        <SettingsRow
          title="Secure sessions"
          subtitle="Encrypted sessions with your contacts, kept on this phone."
          value={diagnosticsLoading ? 'Checking' : `${diagnostics?.sessionCount ?? 0}`}
        />
        <SettingsRow
          title="Stored messages"
          subtitle="Messages kept on this phone, each stored encrypted."
          value={diagnosticsLoading ? 'Checking' : `${diagnostics?.storedMessagesCount ?? 0}`}
        />
        <SettingsRow
          title="Keys for new chats"
          subtitle="Spare keys that let a contact start a secure chat with you while you are offline."
          value={
            diagnosticsLoading
              ? 'Checking'
              : diagnostics?.signedPreKeyReady
                ? `${diagnostics?.oneTimePreKeysCount ?? 0} ready`
                : 'Missing'
          }
          last
        />
      </SettingsGroup>
    </>
  );
}
