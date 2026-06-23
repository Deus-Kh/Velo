import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RootStackParamList } from '../app/Navigation';
import { useAuthStore } from '../store/auth.store';

import { keysApi } from '../shared/api/keys.api';
import { ensureIdentityKeyPairForUser } from '../shared/crypto/identityKeys';
import { computeSafetyNumber } from '../shared/crypto/fingerprint';
import { getTrustedIdentity, setTrustedIdentity, clearTrustedIdentity } from '../shared/storage/trustedIdentities';

type Props = NativeStackScreenProps<RootStackParamList, 'VerifyContact'>;

export default function VerifyContactScreen({ route, navigation }: Props) {
  const { peerUserId, peerUsername, peerEmail, source } = route.params;
  const insets = useSafeAreaInsets();
  const myUserId = useAuthStore((s) => s.userId);

  const [loading, setLoading] = useState(true);
  const [theirIdentityPub, setTheirIdentityPub] = useState<string | null>(null);
  const [myIdentityPub, setMyIdentityPub] = useState<string | null>(null);
  const [trusted, setTrusted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!myUserId) {
        setError('Not authenticated');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const myPub = await ensureIdentityKeyPairForUser(myUserId);
        const theirRes = await keysApi.getIdentityKey(peerUserId);
        const trustedStored = await getTrustedIdentity({ myUserId, peerUserId });

        if (!alive) return;

        setMyIdentityPub(myPub);
        setTheirIdentityPub(theirRes.data.identitySignPublicKey);
        setTrusted(trustedStored);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || 'Failed to load identity keys');
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [myUserId, peerUserId]);

  const computed = useMemo(() => {
    if (!myIdentityPub || !theirIdentityPub) return null;
    return computeSafetyNumber({
      myIdentitySignPub: myIdentityPub,
      theirIdentitySignPub: theirIdentityPub,
    });
  }, [myIdentityPub, theirIdentityPub]);

  const status = useMemo(() => {
    if (!theirIdentityPub) return 'unknown';
    if (!trusted) return 'untrusted';
    if (trusted === theirIdentityPub) return 'verified';
    return 'changed';
  }, [trusted, theirIdentityPub]);

  const screenTitle = source === 'new-chat' ? 'Verify Before Chatting' : 'Verify Contact';
  const screenSubtitle =
    source === 'new-chat'
      ? 'Confirm this identity before relying on a new secure conversation.'
      : 'Review the safety number and trust status for this conversation.';

  const statusLabel = useMemo(() => {
    switch (status) {
      case 'verified':
        return 'Verified on this device';
      case 'changed':
        return 'Identity changed';
      case 'untrusted':
        return 'Not verified yet';
      default:
        return 'Checking identity';
    }
  }, [status]);

  const onTrust = async () => {
    if (!myUserId || !theirIdentityPub) return;
    await setTrustedIdentity({
      myUserId,
      peerUserId,
      identitySignPublicKey: theirIdentityPub,
    });
    setTrusted(theirIdentityPub);
  };

  const onClearTrust = async () => {
    if (!myUserId) return;
    await clearTrustedIdentity({ myUserId, peerUserId });
    setTrusted(null);
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="px-4 pt-2">
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-[31px] font-semibold text-text">{screenTitle}</Text>
            <Text className="mt-1 text-sm text-muted">{screenSubtitle}</Text>
          </View>

          <Pressable
            onPress={() => navigation.goBack()}
            className="rounded-full border border-border bg-surface/85 px-4 py-2 active:opacity-80"
          >
            <Text className="text-sm font-semibold text-text">
              {source === 'new-chat' ? 'Close' : 'Back'}
            </Text>
          </Pressable>
        </View>

        <View className="mt-4 rounded-[24px] border border-border bg-surface/88 p-4">
          <View className="flex-row items-center">
            <View className="mr-4 h-16 w-16 items-center justify-center rounded-full bg-primary-soft">
              <Text className="text-xl font-semibold text-primary">
                {(peerUsername || peerUserId || '?').slice(0, 1).toUpperCase()}
              </Text>
            </View>

            <View className="flex-1">
              <Text className="text-xl font-semibold text-text">
                {peerUsername || 'Unknown contact'}
              </Text>
              <Text className="mt-1 text-sm text-muted">{peerEmail || peerUserId}</Text>
              <View
                className={`mt-3 self-start rounded-full border px-3 py-1 ${
                  status === 'verified'
                    ? 'border-success/30 bg-success/10'
                    : status === 'changed'
                      ? 'border-danger/30 bg-danger/10'
                      : 'border-warning/30 bg-warning/10'
                }`}
              >
                <Text
                  className={`text-xs font-semibold ${
                    status === 'verified'
                      ? 'text-success'
                      : status === 'changed'
                        ? 'text-danger'
                        : 'text-warning'
                  }`}
                >
                  {statusLabel}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {loading ? (
          <View className="mt-5 items-center rounded-[22px] border border-border bg-surface/88 px-5 py-8">
            <ActivityIndicator size="small" color="#2DD4BF" />
            <Text className="mt-4 text-sm text-muted">Loading identity keys...</Text>
          </View>
        ) : null}

        {!loading && error ? (
          <View className="mt-5 rounded-[22px] border border-danger/40 bg-danger/10 p-5">
            <Text className="text-base font-semibold text-danger">Unable to load verification data</Text>
            <Text className="mt-2 text-sm leading-6 text-muted">{error}</Text>
          </View>
        ) : null}

        {!loading && !error && computed ? (
          <View className="mt-5 rounded-[24px] border border-border bg-surface/92 p-5">
            <Text className="text-xs font-semibold uppercase tracking-[1.4px] text-muted">Safety Number</Text>
            <Text className="mt-3 text-2xl font-semibold text-text">
              {computed.displayCode}
            </Text>

            <View className="mt-5 rounded-[18px] border border-border bg-background-alt/70 p-4">
              <Text className="text-xs font-semibold uppercase tracking-[1.4px] text-muted">Trust Status</Text>

              {status === 'verified' ? (
                <Text className="mt-2 text-base font-semibold text-success">Verified</Text>
              ) : null}

              {status === 'untrusted' ? (
                <Text className="mt-2 text-base font-semibold text-warning">Not verified</Text>
              ) : null}

              {status === 'changed' ? (
                <Text className="mt-2 text-base font-semibold text-danger">Identity changed</Text>
              ) : null}

              <Text className="mt-2 text-sm leading-6 text-muted">
                {status === 'verified'
                  ? 'You marked this identity as trusted on this device.'
                  : status === 'changed'
                    ? 'The saved identity key no longer matches. This can happen after reinstall or key rotation.'
                    : 'Compare the safety number with your contact before trusting this key.'}
              </Text>
            </View>

            <View className="mt-5 flex-row gap-3">
              {status !== 'verified' ? (
                <Pressable
                  onPress={onTrust}
                  className="flex-1 rounded-[18px] bg-primary px-4 py-3.5 active:opacity-80"
                >
                  <Text className="text-center font-semibold text-background">
                    {status === 'changed' ? 'Trust new key' : 'Trust key'}
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => navigation.goBack()}
                  className="flex-1 rounded-[18px] bg-primary px-4 py-3.5 active:opacity-80"
                >
                  <Text className="text-center font-semibold text-background">
                    {source === 'new-chat' ? 'Done' : 'Back to chat'}
                  </Text>
                </Pressable>
              )}

              {(status === 'verified' || status === 'changed') ? (
                <Pressable
                  onPress={onClearTrust}
                  className="flex-1 rounded-[18px] border border-border bg-surface-elevated px-4 py-3.5 active:opacity-80"
                >
                  <Text className="text-center font-semibold text-text">Clear trust</Text>
                </Pressable>
              ) : null}
            </View>

            <Text className="mt-4 text-xs leading-5 text-muted">
              Tip: compare this code with your contact using another trusted channel before you trust the key.
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
