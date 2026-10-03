import type { RefObject } from 'react';
import { Platform, Pressable, Text, TextInput, ToastAndroid, View } from 'react-native';

import ComposerFrame from './ComposerFrame';
import EditBar from './EditBar';
import ReplyBar from './ReplyBar';
import SendIcon from './SendIcon';
import UploadProgressBar, { type UploadState } from './UploadProgressBar';
import VoiceComposer from '../VoiceComposer';
import type { Recording } from '../../shared/media/voiceNotes';
import type { DescribableMessage } from '../../shared/chat/describeMessage';
import { useAppearanceStore } from '../../store/appearance.store';

/**
 * C1: the 1:1 chat's composer: the reply / edit / upload bars, the reason
 * sending is off, the "+" button, the text field, and send or the mic
 * (which is the hold-to-record control of `VoiceComposer`).
 */
export default function ChatComposer({
  inputRef,
  text,
  onChangeText,
  onSend,
  canSend,
  showMic,
  editable,
  conversationName,
  replyTarget,
  onCancelReply,
  editTarget,
  onCancelEdit,
  uploadState,
  disabledReason,
  onOpenActions,
  onRecorded,
}: {
  inputRef: RefObject<TextInput | null>;
  text: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  canSend: boolean;
  showMic: boolean;
  editable: boolean;
  conversationName: string;
  replyTarget: (DescribableMessage & { mine: boolean }) | null;
  onCancelReply: () => void;
  editTarget: DescribableMessage | null;
  onCancelEdit: () => void;
  uploadState: UploadState | null;
  disabledReason: string | null;
  onOpenActions: () => void;
  onRecorded: (recording: Recording) => void;
}) {
  const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);
  const surfaceStyle = useAppearanceStore((s) => s.surfaceStyle);

  const composerSurfaceClass =
    surfaceStyle === 'glass' ? 'bg-surface/84' : 'bg-surface-elevated';
  const composerButtonSizeClass =
    interfaceDensity === 'compact' ? 'h-11 w-11' : 'h-12 w-12';
  const composerInputMinHeightClass =
    interfaceDensity === 'compact' ? 'min-h-[40px] py-2.5' : 'min-h-[44px] py-3';
  const composerContainerMinHeightClass =
    interfaceDensity === 'compact' ? 'min-h-[44px]' : 'min-h-[48px]';

  return (
    <ComposerFrame>
      {replyTarget ? <ReplyBar target={replyTarget} conversationName={conversationName} onCancel={onCancelReply} /> : null}

      {uploadState ? <UploadProgressBar state={uploadState} /> : null}

      {editTarget ? <EditBar message={editTarget} onCancel={onCancelEdit} /> : null}

      {disabledReason ? (
        <Text className="mb-2 px-1 text-[12px] leading-5 text-muted">
          {disabledReason}
        </Text>
      ) : null}

      <VoiceComposer
        active={showMic}
        disabled={Boolean(uploadState)}
        sizeClass={composerButtonSizeClass}
        surfaceClass={composerSurfaceClass}
        onRecorded={onRecorded}
        onError={(m) => {
          if (Platform.OS === 'android') ToastAndroid.show(m, ToastAndroid.SHORT);
        }}
      >
        <Pressable
          onPress={onOpenActions}
          className={`${composerButtonSizeClass} items-center justify-center rounded-full border border-border ${composerSurfaceClass} active:opacity-80`}
        >
          <Text className="text-[24px] leading-none text-text">+</Text>
        </Pressable>

        <View
          className={`flex-1 rounded-[24px] border border-border bg-surface-elevated px-4 ${composerContainerMinHeightClass} ${
            interfaceDensity === 'compact' ? 'py-0.5' : 'py-1'
          }`}
        >
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={onChangeText}
            placeholder="Message"
            placeholderTextColor="#94A3B8"
            selectionColor="#2DD4BF"
            cursorColor="#2DD4BF"
            underlineColorAndroid="transparent"
            className={`max-h-32 text-[15px] leading-6 text-text ${composerInputMinHeightClass}`}
            returnKeyType="send"
            onSubmitEditing={onSend}
            editable={editable}
            multiline
            maxLength={4000}
            textAlignVertical="top"
          />
        </View>

        {showMic ? null : (
          <Pressable
            onPress={onSend}
            disabled={!canSend}
            className={`${composerButtonSizeClass} items-center justify-center rounded-full ${
              canSend ? 'bg-primary' : `border border-border ${composerSurfaceClass}`
            } active:opacity-80`}
          >
            <SendIcon color={canSend ? '#04131E' : '#94A3B8'} />
          </Pressable>
        )}
      </VoiceComposer>
    </ComposerFrame>
  );
}
