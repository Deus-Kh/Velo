import { Pressable, Text } from 'react-native';

import BottomSheetPanel from '../BottomSheetPanel';
import { formatTimer } from '../../shared/chat/disappearing';

/**
 * C1: the "+" sheet of a 1:1 chat. Every row closes the sheet first and
 * then hands the action back to the screen.
 */
export default function ChatActionsSheet({
  peerBlocked,
  verified,
  timerSeconds,
  sessionResetRequired,
  onClose,
  onVerify,
  onToggleBlock,
  onReport,
  onJumpToLatest,
  onSendPhoto,
  onSearch,
  onTimer,
  onResetSession,
}: {
  peerBlocked: boolean;
  verified: boolean;
  timerSeconds: number | null;
  sessionResetRequired: boolean;
  onClose: () => void;
  onVerify: () => void;
  onToggleBlock: () => void;
  onReport: () => void;
  onJumpToLatest: () => void;
  onSendPhoto: () => void;
  onSearch: () => void;
  onTimer: () => void;
  onResetSession: () => void;
}) {
  return (
    <BottomSheetPanel title="Chat Actions" onClose={onClose}>
      {!verified ? (
        <Pressable
          onPress={() => {
            onClose();
            onVerify();
          }}
          className="rounded-[18px] px-3 py-3 active:opacity-80"
        >
          <Text className="text-[15px] font-medium text-text">Verify contact</Text>
          <Text className="mt-1 text-[13px] leading-5 text-muted">
            Review identity fingerprints and trust this contact on this device.
          </Text>
        </Pressable>
      ) : null}

      <Pressable
        onPress={() => {
          onClose();
          onToggleBlock();
        }}
        className="rounded-[18px] px-3 py-3 active:opacity-80"
      >
        <Text className={`text-[15px] font-medium ${peerBlocked ? 'text-text' : 'text-danger'}`}>{peerBlocked ? 'Unblock contact' : 'Block contact'}</Text>
        <Text className="mt-1 text-[13px] leading-5 text-muted">
          {peerBlocked ? 'Messages, presence and typing flow again.' : 'They can no longer message you or see you; they are not told. History stays on this device.'}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => {
          onClose();
          onReport();
        }}
        className="rounded-[18px] px-3 py-3 active:opacity-80"
      >
        <Text className="text-[15px] font-medium text-text">Report contact</Text>
        <Text className="mt-1 text-[13px] leading-5 text-muted">Send a reason and, if you want, a note. Your messages stay encrypted.</Text>
      </Pressable>

      <Pressable
        onPress={() => {
          onClose();
          onJumpToLatest();
        }}
        className="rounded-[18px] px-3 py-3 active:opacity-80"
      >
        <Text className="text-[15px] font-medium text-text">Jump to latest</Text>
        <Text className="mt-1 text-[13px] leading-5 text-muted">
          Scroll to the newest message in this conversation.
        </Text>
      </Pressable>

      <Pressable
        onPress={() => {
          onClose();
          onSendPhoto();
        }}
        className="rounded-[18px] px-3 py-3 active:opacity-80"
      >
        <Text className="text-[15px] font-medium text-text">Send a photo</Text>
        <Text className="mt-1 text-[13px] leading-5 text-muted">Metadata is stripped, the photo is encrypted on this device; the composer text becomes the caption.</Text>
      </Pressable>

      <Pressable
        onPress={() => {
          onClose();
          onSearch();
        }}
        className="rounded-[18px] px-3 py-3 active:opacity-80"
      >
        <Text className="text-[15px] font-medium text-text">Search in chat</Text>
        <Text className="mt-1 text-[13px] leading-5 text-muted">Find a message stored on this device and jump to it.</Text>
      </Pressable>

      <Pressable
        onPress={() => {
          onClose();
          onTimer();
        }}
        className="rounded-[18px] px-3 py-3 active:opacity-80"
      >
        <Text className="text-[15px] font-medium text-text">Disappearing messages</Text>
        <Text className="mt-1 text-[13px] leading-5 text-muted">
          {timerSeconds ? `Currently ${formatTimer(timerSeconds)}. New messages vanish from both devices after that.` : 'Off. Set a timer after which new messages vanish from both devices.'}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => {
          onClose();
          if (sessionResetRequired) {
            onResetSession();
          }
        }}
        className="rounded-[18px] px-3 py-3 active:opacity-80"
      >
        <Text
          className={`text-[15px] font-medium ${
            sessionResetRequired ? 'text-warning' : 'text-text'
          }`}
        >
          Reset secure session
        </Text>
        <Text className="mt-1 text-[13px] leading-5 text-muted">
          Rebuild the encrypted session if this conversation stops decrypting reliably.
        </Text>
      </Pressable>
    </BottomSheetPanel>
  );
}
