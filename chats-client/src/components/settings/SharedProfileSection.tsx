import Avatar from '../Avatar';
import SectionEyebrow from '../SectionEyebrow';
import { SettingsGroup, SettingsRow } from './primitives';
import { useProfilesStore } from '../../store/profiles.store';

/** Settings → Shared profile: the name and avatar contacts see (T7.7), edited in a sheet the screen owns. */
export default function SharedProfileSection({ fallbackName, onOpen }: { fallbackName: string | undefined; onOpen: () => void }) {
  const ownProfile = useProfilesStore((s) => s.own);

  return (
    <>
      <SectionEyebrow title="Shared profile" description="Travels over your encrypted sessions; the server stores none of it." />
      <SettingsGroup>
        <SettingsRow
          title="Name and avatar"
          subtitle={ownProfile ? `${ownProfile.name}${ownProfile.avatar ? ' · avatar set' : ' · no avatar'}` : 'Not set: contacts see your username.'}
          onPress={onOpen}
          trailing={<Avatar name={ownProfile?.name || fallbackName || 'U'} profile={ownProfile} size="sm" />}
          last
        />
      </SettingsGroup>
    </>
  );
}
