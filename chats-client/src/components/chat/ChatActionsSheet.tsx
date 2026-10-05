import BottomSheetPanel, { BottomSheetAction } from '../BottomSheetPanel';
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
  onSearch: () => void;
  onTimer: () => void;
  onResetSession: () => void;
}) {
  return (
    <BottomSheetPanel title="Chat Actions" onClose={onClose}>
      {!verified ? (
        <BottomSheetAction
          icon="badge-check"
          label="Verify contact"
          onPress={() => {
            onClose();
            onVerify();
          }}
        >
        </BottomSheetAction>
      ) : null}

      <BottomSheetAction
        icon={peerBlocked ? 'unlock' : 'ban'}
        label={peerBlocked ? 'Unblock contact' : 'Block contact'}
        tone={peerBlocked ? 'default' : 'danger'}
        onPress={() => {
          onClose();
          onToggleBlock();
        }}
      >
      </BottomSheetAction>

      <BottomSheetAction
        icon="flag"
        label="Report contact"
        onPress={() => {
          onClose();
          onReport();
        }}
      >
      </BottomSheetAction>

      <BottomSheetAction
        icon="arrow-down-to-line"
        label="Jump to latest"
        onPress={() => {
          onClose();
          onJumpToLatest();
        }}
      >
      </BottomSheetAction>

      <BottomSheetAction
        icon="search"
        label="Search in chat"
        onPress={() => {
          onClose();
          onSearch();
        }}
      >
      </BottomSheetAction>

      <BottomSheetAction
        icon="timer"
        label={timerSeconds ? `Disappearing messages · ${formatTimer(timerSeconds)}` : 'Disappearing messages'}
        onPress={() => {
          onClose();
          onTimer();
        }}
      >
      </BottomSheetAction>

      <BottomSheetAction
        icon="rotate-ccw"
        label="Reset secure session"
        tone={sessionResetRequired ? 'warning' : 'default'}
        onPress={() => {
          onClose();
          if (sessionResetRequired) onResetSession();
        }}
      >
      </BottomSheetAction>
    </BottomSheetPanel>
  );
}
