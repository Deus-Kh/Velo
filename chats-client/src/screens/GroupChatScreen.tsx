import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboard } from '@react-native-community/hooks';

import BottomSheetPanel from '../components/BottomSheetPanel';
import MessageBubble from '../components/MessageBubble';
import StatusChip from '../components/StatusChip';
import { userApi, type UserListItem } from '../shared/api/user.api';
import { groupsApi, type GroupMember } from '../shared/api/groups.api';
import { useGroupChat, type GroupUIMessage } from '../shared/chat/useGroupChat';
import { deleteGroupKeys } from '../shared/storage/senderKeyStore';
import { useAppearanceStore } from '../store/appearance.store';
import { useAuthStore } from '../store/auth.store';
import { formatHandle } from '../shared/utils/identity';

/**
 * T6.4: one group conversation. Messages are Sender-Key encrypted (T6.1);
 * each member's key reaches us over the pairwise session, so a message
 * whose key has not arrived yet is shown as "waiting" rather than lost.
 */
const messageListContentStyle = { paddingBottom: 20 };

type MemberSheet = 'members' | 'add' | null;

function memberName(m: GroupMember | undefined, userId: string): string {
  return m?.username ? m.username : userId.slice(-6);
}

function SenderLabel({ name }: { name: string }) {
  return <Text className="mb-0.5 ml-3 text-[11px] font-semibold text-primary">{name}</Text>;
}

export default function GroupChatScreen({ groupId, initialName, onClose }: { groupId: string; initialName?: string; onClose: () => void }) {
  const myUserId = useAuthStore((s) => s.userId);
  const insets = useSafeAreaInsets();
  const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);
  const surfaceStyle = useAppearanceStore((s) => s.surfaceStyle);
  const { keyboardShown, keyboardHeight } = useKeyboard();
  const { group, messages, loading, waitingForKeys, securityWarning, send, addMembers, removeMember } = useGroupChat(groupId);

  const [text, setText] = useState('');
  const [sheet, setSheet] = useState<MemberSheet>(null);
  const [memberQuery, setMemberQuery] = useState('');
  const [candidates, setCandidates] = useState<UserListItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const flatListRef = useRef<FlatList<GroupUIMessage>>(null);

  const name = group?.name ?? initialName ?? 'Group';
  const membersById = useMemo(() => new Map((group?.members ?? []).map((m) => [m.userId, m])), [group]);
  const me = myUserId ? membersById.get(String(myUserId)) : undefined;
  const isAdmin = me?.role === 'admin';
  const hasNavigationButtons = insets.bottom >= 40;
  const canSend = text.trim().length > 0 && Boolean(group);
  const reversed = useMemo(() => [...messages].reverse(), [messages]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (sheet) {
        setSheet(null);
        return true;
      }
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose, sheet]);

  useEffect(() => {
    if (sheet !== 'add') return;
    const q = memberQuery.trim();
    if (q.length < 2) {
      setCandidates([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await userApi.getUsers({ q, limit: 20 });
        setCandidates(res.data.items.filter((u) => !membersById.has(u.userId)));
      } catch (e: any) {
        setActionError(e?.message || 'Search failed');
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [memberQuery, membersById, sheet]);

  const onSend = useCallback(async () => {
    const value = text;
    if (!value.trim()) return;
    setText('');
    await send(value);
  }, [send, text]);

  const runAction = useCallback(async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setActionError(null);
    try {
      await action();
    } catch (e: any) {
      setActionError(e?.response?.data?.error || e?.message || 'Action failed');
    } finally {
      setBusy(null);
    }
  }, []);

  const onLeave = useCallback(() => {
    runAction('leave', async () => {
      await groupsApi.leave(groupId);
      if (myUserId) await deleteGroupKeys(String(myUserId), groupId);
      setSheet(null);
      onClose();
    });
  }, [groupId, myUserId, onClose, runAction]);

  const subtitle = group
    ? `${group.members.length} member${group.members.length === 1 ? '' : 's'} · epoch ${group.epoch}`
    : 'Loading…';

  const composerSurfaceClass = surfaceStyle === 'glass' ? 'bg-surface/82' : 'bg-surface-elevated';
  const buttonSizeClass = interfaceDensity === 'compact' ? 'h-10 w-10' : 'h-11 w-11';

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
    >
      <View className="px-4" style={{ paddingTop: insets.top + 6 }}>
        <View
          className={`rounded-[22px] border border-border px-4 ${interfaceDensity === 'compact' ? 'py-2.5' : 'py-3'} ${
            surfaceStyle === 'glass' ? 'bg-surface/88' : 'bg-surface-elevated'
          }`}
        >
          <View className="flex-row items-center">
            <Pressable
              onPress={onClose}
              className={`mr-3 items-center justify-center rounded-full border border-border active:opacity-80 ${
                interfaceDensity === 'compact' ? 'h-9 w-9' : 'h-10 w-10'
              } ${surfaceStyle === 'glass' ? 'bg-background-alt/60' : 'bg-background-alt'}`}
            >
              <Text className="text-2xl leading-none text-text">{'‹'}</Text>
            </Pressable>

            <View className="mr-3 h-11 w-11 items-center justify-center rounded-full bg-primary-soft">
              <Text className="text-base font-semibold text-primary">{name.slice(0, 1).toUpperCase()}</Text>
            </View>

            <View className="flex-1 pr-2">
              <Text className="text-[20px] font-semibold text-text" numberOfLines={1}>
                {name}
              </Text>
              <Text className="mt-1 text-sm leading-5 text-muted">{subtitle}</Text>
              {waitingForKeys.length > 0 ? (
                <View className="mt-2.5">
                  <StatusChip tone="warning" label={`Waiting for ${waitingForKeys.length} member key${waitingForKeys.length === 1 ? '' : 's'}`} />
                </View>
              ) : null}
              {securityWarning ? (
                <View className="mt-2">
                  <StatusChip tone="danger" label={`Bad signature from ${memberName(membersById.get(securityWarning.fromUserId), securityWarning.fromUserId)}`} />
                </View>
              ) : null}
            </View>

            <Pressable
              onPress={() => setSheet('members')}
              className={`rounded-full border border-border px-4 ${interfaceDensity === 'compact' ? 'py-1.5' : 'py-2'} active:opacity-80 ${
                surfaceStyle === 'glass' ? 'bg-background-alt/60' : 'bg-background-alt'
              }`}
            >
              <Text className="text-sm font-semibold text-text">Members</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View className="flex-1 px-3 pt-3">
        {loading && messages.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="small" color="#2DD4BF" />
          </View>
        ) : messages.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-center text-xl font-semibold text-text">No messages yet</Text>
            <Text className="mt-2 text-center text-sm leading-6 text-muted">
              Everything here is encrypted per sender. Members receive your key over your private sessions with them.
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            inverted
            data={reversed}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => {
              const newer = reversed[index - 1];
              const showSender = !item.mine && (!newer || newer.senderUserId !== item.senderUserId);
              return (
                <View>
                  {showSender ? <SenderLabel name={memberName(membersById.get(item.senderUserId ?? ''), item.senderUserId ?? '')} /> : null}
                  <MessageBubble text={item.text} mine={item.mine} status={item.status} timestamp={item.createdAt} />
                </View>
              );
            }}
            contentContainerStyle={messageListContentStyle}
            removeClippedSubviews={false}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </View>

      {sheet === 'members' && group ? (
        <BottomSheetPanel title={`${group.members.length} members`} onClose={() => setSheet(null)}>
          <View className="max-h-72">
            <FlatList
              data={group.members}
              keyExtractor={(m) => m.userId}
              renderItem={({ item }) => {
                const isMe = item.userId === String(myUserId);
                return (
                  <View className="flex-row items-center py-2">
                    <View className="mr-3 h-9 w-9 items-center justify-center rounded-full bg-primary-soft">
                      <Text className="text-sm font-semibold text-primary">{memberName(item, item.userId).slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-text">
                        {memberName(item, item.userId)}
                        {isMe ? ' (you)' : ''}
                      </Text>
                      <Text className="text-xs text-muted">{item.username ? formatHandle(item.username) : item.userId}</Text>
                    </View>
                    {item.role === 'admin' ? <StatusChip size="xs" tone="primary" label="Admin" /> : null}
                    {isAdmin && !isMe ? (
                      <Pressable
                        disabled={busy !== null}
                        onPress={() => runAction(item.userId, () => removeMember(item.userId))}
                        className="ml-2 rounded-full border border-danger/40 px-3 py-1 active:opacity-80"
                      >
                        <Text className="text-xs font-semibold text-danger">{busy === item.userId ? '…' : 'Remove'}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              }}
            />
          </View>
          {actionError ? <Text className="mt-2 px-1 text-xs text-danger">{actionError}</Text> : null}
          <View className="mt-3 flex-row gap-2">
            {isAdmin ? (
              <Pressable onPress={() => setSheet('add')} className="flex-1 items-center rounded-[16px] bg-primary py-3 active:opacity-80">
                <Text className="font-semibold text-background">Add members</Text>
              </Pressable>
            ) : null}
            <Pressable disabled={busy !== null} onPress={onLeave} className="flex-1 items-center rounded-[16px] border border-danger/40 py-3 active:opacity-80">
              <Text className="font-semibold text-danger">{busy === 'leave' ? 'Leaving…' : 'Leave group'}</Text>
            </Pressable>
          </View>
        </BottomSheetPanel>
      ) : null}

      {sheet === 'add' ? (
        <BottomSheetPanel title="Add members" onClose={() => setSheet('members')}>
          <View className="rounded-[16px] border border-border bg-surface/92 px-4">
            <TextInput
              value={memberQuery}
              onChangeText={setMemberQuery}
              placeholder="Search by username"
              placeholderTextColor="#94A3B8"
              autoCapitalize="none"
              autoFocus
              className="py-3 text-[15px] text-text"
            />
          </View>
          <View className="mt-2 max-h-64">
            <FlatList
              data={candidates}
              keyExtractor={(u) => u.userId}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text className="px-1 py-3 text-xs text-muted">{memberQuery.trim().length < 2 ? 'Type at least two characters.' : 'No one to add.'}</Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  disabled={busy !== null || !item.hasPublicKey}
                  onPress={() =>
                    runAction(item.userId, async () => {
                      await addMembers([item.userId]);
                      setSheet('members');
                    })
                  }
                  className="flex-row items-center py-2 active:opacity-80"
                >
                  <View className="mr-3 h-9 w-9 items-center justify-center rounded-full bg-primary-soft">
                    <Text className="text-sm font-semibold text-primary">{item.username.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-text">{item.username}</Text>
                    <Text className="text-xs text-muted">{item.hasPublicKey ? 'Ready for E2EE' : 'No public key yet'}</Text>
                  </View>
                  <Text className="text-xs font-semibold text-primary">{busy === item.userId ? '…' : 'Add'}</Text>
                </Pressable>
              )}
            />
          </View>
          {actionError ? <Text className="mt-2 px-1 text-xs text-danger">{actionError}</Text> : null}
        </BottomSheetPanel>
      ) : null}

      <View
        className={`px-3 ${interfaceDensity === 'compact' ? 'pt-1.5' : 'pt-2'}`}
        style={{ paddingBottom: keyboardShown ? (hasNavigationButtons ? keyboardHeight + insets.bottom + 5 : insets.bottom + 5) : insets.bottom + 8 }}
      >
        <View className="flex-row items-center gap-2.5">
          <View className={`flex-1 rounded-[24px] border border-border bg-surface-elevated px-4 ${interfaceDensity === 'compact' ? 'py-0.5' : 'py-1'}`}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Message"
              placeholderTextColor="#94A3B8"
              selectionColor="#2DD4BF"
              cursorColor="#2DD4BF"
              underlineColorAndroid="transparent"
              className="max-h-32 min-h-[40px] text-[15px] leading-6 text-text"
              returnKeyType="send"
              onSubmitEditing={onSend}
              editable={Boolean(group)}
              multiline
              maxLength={4000}
              textAlignVertical="top"
            />
          </View>
          <Pressable
            onPress={onSend}
            disabled={!canSend}
            className={`${buttonSizeClass} items-center justify-center rounded-full ${canSend ? 'bg-primary' : `border border-border ${composerSurfaceClass}`} active:opacity-80`}
          >
            <Text className={`text-lg font-semibold ${canSend ? 'text-background' : 'text-muted'}`}>{'↑'}</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
