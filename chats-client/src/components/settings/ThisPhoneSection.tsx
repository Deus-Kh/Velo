import { useState } from 'react';
import { Alert } from 'react-native';

import SectionEyebrow from '../SectionEyebrow';
import StatusChip from '../StatusChip';
import { InfoNote, SettingsGroup, SettingsRow } from './primitives';
import { wipeLocalStateForUser } from '../../shared/storage/localWipe';

/** Settings → This phone: the device's session, a re-check, and the local encryption reset (confirmed). */
export default function ThisPhoneSection({
  userId,
  diagnosticsLoading,
  loadDiagnostics,
}: {
  userId: string | null;
  diagnosticsLoading: boolean;
  loadDiagnostics: () => Promise<void>;
}) {
  const [isResettingSecurity, setIsResettingSecurity] = useState(false);
  const [securityResetStatus, setSecurityResetStatus] = useState<string | null>(null);

  const resetLocalSecurityState = async () => {
    if (!userId || isResettingSecurity) return;

    setIsResettingSecurity(true);
    setSecurityResetStatus(null);

    try {
      const report = await wipeLocalStateForUser(userId, 'all');
      if (report.failures.length) {
        console.warn('[Settings] partial wipe:', report.failures.join('; '));
      }

      setSecurityResetStatus('Local secure state was cleared for this account.');
      await loadDiagnostics();
    } catch (error) {
      console.warn('[Settings] Failed to reset local secure state:', error);
      setSecurityResetStatus('Failed to clear local secure state. Please try again.');
    } finally {
      setIsResettingSecurity(false);
    }
  };

  const confirmResetLocalSecurityState = () => {
    Alert.alert(
      'Reset encryption on this phone?',
      'This removes your keys and secure sessions from this phone. ' +
        'Contacts will see that your safety number changed, and each chat starts a fresh secure session. ' +
        'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => { resetLocalSecurityState(); } },
      ],
    );
  };

  return (
    <>
      <SectionEyebrow
        title="This phone"
        description="Your session on this phone and how to recover it."
      />
      <SettingsGroup>
        <SettingsRow
          title="Current device"
          subtitle="Signed in on this phone. Secure chats resume on their own after a reconnect."
          trailing={<StatusChip label="Connected" tone="success" />}
        />
        <SettingsRow
          title="Check again"
          subtitle="Re-check the keys and sessions on this phone."
          onPress={loadDiagnostics}
          value={diagnosticsLoading ? 'Refreshing' : 'Refresh'}
        />
        <SettingsRow
          title="Reset encryption on this phone"
          subtitle="Removes this account's secure sessions, trusted contacts and keys from this phone. Chats start fresh secure sessions afterwards."
          onPress={confirmResetLocalSecurityState}
          value={isResettingSecurity ? 'Resetting' : 'Clear'}
          danger
          last
        />
      </SettingsGroup>
      {securityResetStatus ? <InfoNote>{securityResetStatus}</InfoNote> : null}
    </>
  );
}
