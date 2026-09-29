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
  ToastAndroid,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboard } from '@react-native-community/hooks';
import Clipboard from '@react-native-clipboard/clipboard';

import BottomSheetPanel from '../components/BottomSheetPanel';
import ForwardPicker from '../components/ForwardPicker';
import MessageActionsSheet from '../components/MessageActionsSheet';
import MessageBubble from '../components/MessageBubble';
import { forwardMessage, summarizeReactions } from '../shared/chat/actions';
import { formatTimer } from '../shared/chat/disappearing';
import Avatar from '../components/Avatar';
import SearchInChatSheet from '../components/SearchInChatSheet';
import { useProfilesStore } from '../store/profiles.store';
import TimerSheet from '../components/TimerSheet';
import StatusChip from '../components/StatusChip';
import { userApi, type UserListItem } from '../shared/api/user.api';
import { groupPeerKey, groupsApi, type GroupMember } from '../shared/api/groups.api';
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

type MemberSheet = 'members' | 'add' | 'timer' | 'search' | null;

function memberName(m: GroupMember | undefined, userId: string, profiles?: Record<string, { name: string }>): string {
  const shared = profiles?.[userId]?.name?.trim();
  if (shared) return shared;
  return m?.username ? m.username : userId.slice(-6);
}

function SenderLabel({ name }: { name: string }) {
  return <Text className="mb-0.5 ml-3 text-[11px] font-semibold text-primary">{name}</Text>;
}

export default function GroupChatScreen({ groupId, initialName, jumpToMessageId, onClose }: { groupId: string; initialName?: string; jumpToMessageId?: string; onClose: () => void }) {
  const myUserId = useAuthStore((s) => s.userId);
  const insets = useSafeAreaInsets();
  const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);
  const surfaceStyle = useAppearanceStore((s) => s.surfaceStyle);
  const { keyboardShown, keyboardHeight } = useKeyboard();
  const profiles = useProfilesStore((s) => s.byUser);
  const { group, messages, loading, removed, waitingForKeys, securityWarning, timer, setTimer, send, addMembers, removeMember, react, edit, deleteEverywhere, deleteLocally } = useGroupChat(groupId);

  const [text, setText] = useState('');
  const [sheet, setSheet] = useState<MemberSheet>(null);
  const [selected, setSelected] = useState<GroupUIMessage | null>(null);
  const [jumpTarget, setJumpTarget] = useState<string | null>(jumpToMessageId ?? null);
  const [editTarget, setEditTarget] = useState<GroupUIMessage | null>(null);
  const [forwardTarget, setForwardTarget] = useState<GroupUIMessage | null>(null);
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

  // T7.8: jump to a message from search once it is in the list (the group list holds the newest page).
  useEffect(() => {
    if (!jumpTarget || loading) return;
    const idx = reversed.findIndex((m) => m.id === jumpTarget);
    if (idx >= 0) setTimeout(() => flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 }), 80);
    setJumpTarget(null);
  }, [jumpTarget, loading, reversed]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (sheet || selected || forwardTarget) {
        setSheet(null);
        setSelected(null);
        setForwardTarget(null);
        return true;
      }
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [forwardTarget, onClose, selected, sheet]);

  useEffect(() => {
    if (sheet !== 'add') return;
    const q = memberQuery.trim();
    if (q.length < 2) {
      setCandidates([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await userApi.getUsers({ q, limit: 20 });
        setCandidates(res.data.items.filter((u) => !membersById.has(u.userId)));
      } catch (e: any) {
        setActionError(e?.message || 'Search failed');
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [memberQuery, membersById, sheet]);

  const onSend = useCallback(async () => {
    const value = text;
    if (!value.trim()) return;
    setText('');
    if (editTarget) {
      const target = editTarget;
      setEditTarget(null);
      await edit(target, value);
      return;
    }
    await send(value);
  }, [edit, editTarget, send, text]);

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

  const subtitle = removed
    ? 'You are no longer a member'
    : group
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
                  <StatusChip tone="danger" label={`Bad signature from ${memberName(membersById.get(securityWarning.fromUserId), securityWarning.fromUserId, profiles)}`} />
                </View>
              ) : null}
              {timer.timerSeconds ? (
                <View className="mt-2">
                  <StatusChip tone="primary" label={`\u23F1 Disappear after ${formatTimer(timer.timerSeconds)}`} />
                </View>
              ) : null}
            </View>

            <Pressable
              onPress={() => setSheet('search')}
              className={`mr-2 rounded-full border border-border px-3 ${interfaceDensity === 'compact' ? 'py-1.5' : 'py-2'} active:opacity-80 ${
                surfaceStyle === 'glass' ? 'bg-background-alt/60' : 'bg-background-alt'
              }`}
            >
              <Text className="text-sm font-semibold text-text">{'\u2315'}</Text>
            </Pressable>

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
        {removed ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-center text-xl font-semibold text-text">You left or were removed</Text>
            <Text className="mt-2 text-center text-sm leading-6 text-muted">
              The group's keys were deleted on this device. Messages sent after this point cannot be read here.
            </Text>
          </View>
        ) : loading && messages.length === 0 ? (
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
              if (item.system) {
                return (
                  <View className="mb-3 items-center">
                    <View className="rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5">
                      <Text className="text-xs font-medium text-primary">{item.text}</Text>
                    </View>
                  </View>
                );
              }
              const newer = reversed[index - 1];
              const showSender = !item.mine && (!newer || newer.senderUserId !== item.senderUserId);
              return (
                <View>
                  {showSender ? <SenderLabel name={memberName(membersById.get(item.senderUserId ?? ''), item.senderUserId ?? '', profiles)} /> : null}
                  <MessageBubble
                    text={item.text}
                    mine={item.mine}
                    status={item.status}
                    timestamp={item.createdAt}
                    reactions={summarizeReactions(item.reactions, String(myUserId ?? ''))}
                    edited={Boolean(item.editedAt)}
                    deleted={Boolean(item.deletedAt)}
                    forwarded={Boolean(item.forwardedFrom)}
                    onPress={() => setSelected(item)}
                  />
                </View>
              );
            }}
            contentContainerStyle={messageListContentStyle}
            removeClippedSubviews={false}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </View>

      {selected ? (
        <MessageActionsSheet
          snippet={selected.text.replace(/\s+/g, ' ').trim().slice(0, 48)}
          mine={selected.mine}
          deleted={Boolean(selected.deletedAt)}
          failed={selected.status === 'failed'}
          myReaction={myUserId && selected.reactions ? selected.reactions[String(myUserId)] ?? null : null}
          onReact={(emoji, remove) => {
            const target = selected;
            setSelected(null);
            react(target, emoji, remove).catch((e) => console.warn('[groups] reaction failed:', e));
          }}
          onCopy={() => {
            Clipboard.setString(selected.text);
            setSelected(null);
            if (Platform.OS === 'android') ToastAndroid.show('Message copied', ToastAndroid.SHORT);
          }}
          onEdit={() => {
            const target = selected;
            setSelected(null);
            setEditTarget(target);
            setText(target.text);
          }}
          onForward={() => {
            const target = selected;
            setSelected(null);
            setForwardTarget(target);
          }}
          onDeleteForMe={() => {
            const target = selected;
            setSelected(null);
            deleteLocally(target).catch((e) => console.warn('[groups] delete failed:', e));
          }}
          onDeleteForEveryone={() => {
            const target = selected;
            setSelected(null);
            deleteEverywhere(target).catch((e) => console.warn('[groups] delete for everyone failed:', e));
          }}
          onClose={() => setSelected(null)}
        />
      ) : null}

      {forwardTarget && myUserId ? (
        <ForwardPicker
          myUserId={String(myUserId)}
          excludePeerKey={groupPeerKey(groupId)}
          onClose={() => setForwardTarget(null)}
          onPick={(target) => {
            const message = forwardTarget;
            setForwardTarget(null);
            forwardMessage({ myUserId: String(myUserId), fromPeerKey: groupPeerKey(groupId), message, to: target })
              .then(() => {
                if (Platform.OS === 'android') ToastAndroid.show('Forwarded', ToastAndroid.SHORT);
              })
              .catch((e) => console.warn('[groups] forward failed:', e));
          }}
        />
      ) : null}

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
                    <Avatar name={memberName(item, item.userId, profiles)} profile={profiles[item.userId] ?? null} size="sm" className="mr-3" />
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-text">
                        {memberName(item, item.userId, profiles)}
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
          {isAdmin ? (
            <Pressable onPress={() => setSheet('timer')} className="mt-2 rounded-[16px] border border-border px-3 py-2.5 active:opacity-80">
              <Text className="text-sm font-semibold text-text">Disappearing messages: {formatTimer(timer.timerSeconds)}</Text>
              <Text className="mt-0.5 text-xs text-muted">Admins set it for everyone; members are told over their sessions.</Text>
            </Pressable>
          ) : timer.timerSeconds ? (
            <Text className="mt-2 px-1 text-xs text-muted">Messages disappear after {formatTimer(timer.timerSeconds)} (set by an admin).</Text>
          ) : null}
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

      {sheet === 'search' && myUserId ? (
        <SearchInChatSheet
          myUserId={String(myUserId)}
          peerKey={groupPeerKey(groupId)}
          senderName={(userId, mine) => (mine ? 'You' : memberName(membersById.get(userId ?? ''), userId ?? '', profiles))}
          onClose={() => setSheet(null)}
          onJump={(hit) => {
            setSheet(null);
            setJumpTarget(hit.message.id);
          }}
        />
      ) : null}

      {sheet === 'timer' ? (
        <TimerSheet
          current={timer.timerSeconds}
          note="New group messages disappear from every member's device after the chosen time. Members are told over their encrypted sessions; the server never learns it."
          onClose={() => setSheet('members')}
          onPick={(seconds) => {
            setSheet(null);
            runAction('timer', () => setTimer(seconds));
          }}
        />
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
        {editTarget ? (
          <View className={`mb-2.5 flex-row items-center rounded-[20px] border border-border px-4 py-2.5 ${surfaceStyle === 'glass' ? 'bg-surface/82' : 'bg-surface-elevated'}`}>
            <View className="mr-3 h-8 w-1 rounded-full bg-warning" />
            <Text className="flex-1 text-[12px] font-semibold uppercase tracking-[1px] text-warning">Editing message</Text>
            <Pressable
              onPress={() => {
                setEditTarget(null);
                setText('');
              }}
              className="h-8 w-8 items-center justify-center rounded-full bg-background-alt/60 active:opacity-80"
            >
              <Text className="text-lg leading-none text-text">×</Text>
            </Pressable>
          </View>
        ) : null}
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
              editable={Boolean(group) && !removed}
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
