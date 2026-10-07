import { useEffect, useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import Avatar from '../Avatar';
import BottomSheetPanel from '../BottomSheetPanel';
import ListRow from '../ListRow';
import { listVerifiedPeerUserIds } from '../../shared/storage/trustedIdentities';
import { shortSecureId } from '../../shared/utils/identity';
import { useContactsStore } from '../../store/contacts.store';
import { useProfilesStore } from '../../store/profiles.store';

/**
 * B4: the contacts verified on this phone, by name. The list is local
 * (the pins live only here); names come from the shared profiles and the
 * saved contacts, with the short secure id as the last resort.
 */
export default function TrustedContactsSheet({ myUserId, onClose }: { myUserId: string; onClose: () => void }) {
  const profiles = useProfilesStore((s) => s.byUser);
  const savedContacts = useContactsStore((s) => s.savedContactsByUser[myUserId]);
  const [ids, setIds] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listVerifiedPeerUserIds(myUserId)
      .then((list) => {
        if (!cancelled) setIds(list);
      })
      .catch(() => {
        if (!cancelled) setIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [myUserId]);

  const rows = useMemo(
    () =>
      (ids ?? []).map((peerUserId) => {
        const username = savedContacts?.find((c) => c.peerUserId === peerUserId)?.peerUsername;
        const name = profiles[peerUserId]?.name?.trim() || username || shortSecureId(peerUserId);
        return { peerUserId, name, subtitle: username ? `@${username}` : shortSecureId(peerUserId) };
      }),
    [ids, profiles, savedContacts],
  );

  return (
    <BottomSheetPanel title="Trusted contacts" onClose={onClose} scroll={false}>
      <Text className="px-3 pb-2 text-[13px] leading-5 text-muted">Contacts whose safety number you compared and marked as verified on this phone.</Text>
      <View className="max-h-72">
        <FlatList
          data={rows}
          keyExtractor={(r) => r.peerUserId}
          ListEmptyComponent={<Text className="px-3 py-3 text-xs text-muted">{ids === null ? 'Loading…' : 'Nobody is verified yet. Open a chat and tap Verify.'}</Text>}
          renderItem={({ item }) => (
            <ListRow
              avatar={<Avatar name={item.name} profile={profiles[item.peerUserId] ?? null} size="list" />}
              title={item.name}
              titleIcon="badge-check"
              subtitle={item.subtitle}
              padded={false}
            />
          )}
        />
      </View>
    </BottomSheetPanel>
  );
}
