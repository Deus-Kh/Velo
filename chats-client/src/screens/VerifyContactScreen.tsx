import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RootStackParamList } from '../app/Navigation';
import { useAuthStore } from '../store/auth.store';
import { useProfilesStore } from '../store/profiles.store';
import { Icon } from '../components/Icon';
import Avatar from '../components/Avatar';
import { useThemeColors } from '../theme/useThemeColors';

import { keysApi } from '../shared/api/keys.api';
import { ensureIdentityKeyPairForUser } from '../shared/crypto/identityKeys';
import { ensureIdentityDhKeyPairForUser } from '../shared/crypto/identityDhKeys';
import { computeSafetyNumber, verifyIdentityBinding, type Identity } from '@velo/protocol';
import { getTrustedIdentity, setTrustedIdentity, clearTrustedIdentity, type TrustedIdentity } from '../shared/storage/trustedIdentities';
import { resolveVerifyView, type ServerIdentityState } from '../shared/chat/verifyState';
import { withTimeout } from '../shared/utils/withTimeout';

type Props = NativeStackScreenProps<RootStackParamList, 'VerifyContact'>;

const SERVER_TIMEOUT_MS = 8000;

/**
 * Safety number (T2.13): libsignal's numeric fingerprint over both identity
 * keys of both parties, 60 digits, identical on both phones.
 *
 * A10: everything on this phone (own keys, the pinned identity) is read
 * first and shown at once; the server copy of the contact's identity is
 * fetched in the background with a timeout and only confirms the pin or
 * reveals a change. A contact without a pin shows a skeleton of the
 * number until the server answers, with a retry when it does not.
 */
export default function VerifyContactScreen({ route, navigation }: Props) {
  const { peerUserId, peerUsername, source } = route.params;
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const myUserId = useAuthStore((s) => s.userId);
  const peerProfile = useProfilesStore((s) => s.byUser[peerUserId] ?? null);

  const [myIdentity, setMyIdentity] = useState<Identity | null>(null);
  const [trusted, setTrusted] = useState<TrustedIdentity | null>(null);
  const [localReady, setLocalReady] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [server, setServer] = useState<ServerIdentityState>({ kind: 'pending' });
  const [attempt, setAttempt] = useState(0);

  // Local first: own keys and the pin never wait for the network.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!myUserId) {
        setLocalError('Not signed in');
        setLocalReady(true);
        return;
      }
      try {
        const [mySign, myDh, pin] = await Promise.all([ensureIdentityKeyPairForUser(myUserId), ensureIdentityDhKeyPairForUser(myUserId), getTrustedIdentity({ myUserId, peerUserId })]);
        if (!alive) return;
        setMyIdentity({ identitySignPublicKey: mySign, identityDhPublicKey: myDh });
        setTrusted(pin);
      } catch (e: any) {
        if (!alive) return;
        setLocalError(e?.message || 'Could not read the keys on this phone');
      } finally {
        if (alive) setLocalReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [myUserId, peerUserId]);

  // Then the server copy, in the background, bounded by a timeout; `attempt` retries it.
  useEffect(() => {
    let alive = true;
    setServer({ kind: 'pending' });
    (async () => {
      try {
        const res = await withTimeout(keysApi.getIdentityKey(peerUserId), SERVER_TIMEOUT_MS, 'The server did not answer in time');
        if (!alive) return;
        const theirs = res.data;
        if (!theirs.identityDhPublicKey || !theirs.identityBindingSignature) {
          setServer({ kind: 'failed', message: 'This contact has not published a complete identity yet. Ask them to update the app and sign in again.' });
          return;
        }
        // Throws IDENTITY_BINDING_INVALID if the server handed out inconsistent keys.
        verifyIdentityBinding({
          identitySignPublicKey: theirs.identitySignPublicKey,
          identityDhPublicKey: theirs.identityDhPublicKey,
          identityBindingSignature: theirs.identityBindingSignature,
        });
        setServer({ kind: 'ok', identity: { identitySignPublicKey: theirs.identitySignPublicKey, identityDhPublicKey: theirs.identityDhPublicKey } });
      } catch (e: any) {
        if (!alive) return;
        setServer({ kind: 'failed', message: e?.message || 'Could not reach the server' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [peerUserId, attempt]);

  const view = useMemo(() => resolveVerifyView(trusted, server), [trusted, server]);

  const computed = useMemo(() => {
    if (!myUserId || !myIdentity || !view.identity) return null;
    return computeSafetyNumber({ myUserId, myIdentity, theirUserId: peerUserId, theirIdentity: view.identity });
  }, [myUserId, myIdentity, view.identity, peerUserId]);

  const displayName = peerProfile?.name?.trim() || peerUsername || 'Unknown contact';
  const screenTitle = source === 'new-chat' ? 'Verify before chatting' : 'Verify contact';

  const statusLabel =
    view.status === 'verified' ? (view.confirmed ? 'Verified' : 'Verified on this phone') : view.status === 'changed' ? 'Safety number changed' : view.status === 'untrusted' ? 'Not verified yet' : 'Checking';
  const statusTone = view.status === 'verified' ? 'success' : view.status === 'changed' ? 'danger' : 'warning';
  const guidance =
    view.status === 'verified'
      ? 'You marked this identity as trusted on this phone. Compare the number again only if your contact reinstalled the app.'
      : view.status === 'changed'
        ? 'The saved identity no longer matches. This happens after a reinstall or a new phone, or if someone is interfering. Compare the number with your contact before accepting.'
        : 'Compare these digits with your contact over a call or in person. If they match, mark the contact as verified.';

  const onTrust = useCallback(async () => {
    if (!myUserId || server.kind !== 'ok') return;
    await setTrustedIdentity({
      myUserId,
      peerUserId,
      identitySignPublicKey: server.identity.identitySignPublicKey,
      identityDhPublicKey: server.identity.identityDhPublicKey,
    });
    setTrusted({ ...server.identity });
  }, [myUserId, peerUserId, server]);

  const onClearTrust = useCallback(async () => {
    if (!myUserId) return;
    await clearTrustedIdentity({ myUserId, peerUserId });
    setTrusted(null);
  }, [myUserId, peerUserId]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const tone = (t: 'success' | 'danger' | 'warning') => ({
    chip: t === 'success' ? 'border-success/30 bg-success/10' : t === 'danger' ? 'border-danger/30 bg-danger/10' : 'border-warning/30 bg-warning/10',
    text: t === 'success' ? 'text-success' : t === 'danger' ? 'text-danger' : 'text-warning',
  });

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="px-4 pt-2">
        <View className="flex-row items-center">
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            className="mr-3 h-10 w-10 items-center justify-center rounded-full border border-border bg-background-alt active:opacity-80"
          >
            <Icon lib="Lucide" name="chevron-left" size={22} color={colors.text} />
          </Pressable>
          <Text className="flex-1 text-[26px] font-semibold text-text">{screenTitle}</Text>
        </View>

        <View className="mt-4 rounded-[24px] border border-border bg-surface/88 p-4">
          <View className="flex-row items-center">
            <Avatar name={peerUsername || '?'} profile={peerProfile} size="lg" className="mr-4" />
            <View className="flex-1">
              <Text className="text-xl font-semibold text-text">{displayName}</Text>
              {peerUsername && displayName !== peerUsername ? <Text className="mt-0.5 text-sm text-muted">@{peerUsername}</Text> : null}
              <View className={`mt-3 self-start rounded-full border px-3 py-1 ${tone(statusTone).chip}`}>
                <Text className={`text-xs font-semibold ${tone(statusTone).text}`}>{statusLabel}</Text>
              </View>
            </View>
          </View>
        </View>

        {localError ? (
          <View className="mt-5 rounded-[22px] border border-danger/40 bg-danger/10 p-5">
            <Text className="text-base font-semibold text-danger">Cannot verify on this phone</Text>
            <Text className="mt-2 text-sm leading-6 text-muted">{localError}</Text>
          </View>
        ) : null}

        {!localError && localReady && !computed ? (
          <View className="mt-5 rounded-[24px] border border-border bg-surface/92 p-5">
            <Text className="text-xs font-semibold uppercase tracking-[1.4px] text-muted">Safety number</Text>
            {server.kind === 'failed' ? (
              <>
                <Text className="mt-3 text-sm leading-6 text-muted">{view.note}</Text>
                <Pressable onPress={retry} accessibilityRole="button" className="mt-4 self-start rounded-full bg-surface-elevated px-4 py-2 active:opacity-80">
                  <Text className="font-semibold text-text">Try again</Text>
                </Pressable>
              </>
            ) : (
              <>
                {/* a skeleton of the number block, not a spinner: the shape of what is coming */}
                <View className="mt-3 gap-2" accessibilityLabel="Fetching this contact's keys">
                  {[0, 1, 2].map((row) => (
                    <View key={row} className="h-6 w-full rounded-md bg-background-alt/80" />
                  ))}
                </View>
                <Text className="mt-3 text-xs leading-5 text-muted">Fetching this contact's keys…</Text>
              </>
            )}
          </View>
        ) : null}

        {!localError && computed ? (
          <View className="mt-5 rounded-[24px] border border-border bg-surface/92 p-5">
            <Text className="text-xs font-semibold uppercase tracking-[1.4px] text-muted">Safety number</Text>
            <Text className="mt-3 text-xl font-semibold leading-8 text-text" selectable>
              {computed.grouped}
            </Text>
            <Text className="mt-2 text-xs leading-5 text-muted">Both of you see the same 60 digits. They cover both identity keys of both accounts.</Text>

            {view.note ? (
              <View className="mt-4 flex-row items-start rounded-[16px] border border-border bg-background-alt/70 px-3 py-2.5">
                <View className="mr-2 mt-0.5">
                  <Icon lib="Lucide" name={server.kind === 'failed' ? 'circle-alert' : 'clock'} size={14} color={colors.muted} />
                </View>
                <Text className="shrink text-xs leading-5 text-muted">{view.note}</Text>
                {server.kind === 'failed' ? (
                  <Pressable onPress={retry} accessibilityRole="button" hitSlop={8} className="ml-2">
                    <Text className="text-xs font-semibold text-primary">Retry</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <Text className="mt-4 text-sm leading-6 text-muted">{guidance}</Text>

            <View className="mt-5 flex-row gap-3">
              {view.status === 'untrusted' || view.status === 'changed' ? (
                <Pressable onPress={onTrust} disabled={server.kind !== 'ok'} accessibilityRole="button" className={`flex-1 rounded-[18px] px-4 py-3.5 active:opacity-80 ${server.kind === 'ok' ? 'bg-primary' : 'border border-border bg-surface'}`}>
                  <Text className={`text-center font-semibold ${server.kind === 'ok' ? 'text-background' : 'text-muted'}`}>{view.status === 'changed' ? 'Accept new identity' : 'Mark as verified'}</Text>
                </Pressable>
              ) : null}
              {view.status === 'verified' || view.status === 'changed' ? (
                <Pressable onPress={onClearTrust} accessibilityRole="button" className="flex-1 rounded-[18px] border border-border bg-surface-elevated px-4 py-3.5 active:opacity-80">
                  <Text className="text-center font-semibold text-text">Clear trust</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}
