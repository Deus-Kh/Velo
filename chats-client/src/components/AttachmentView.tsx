import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { Image, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { photoFrame } from '../shared/media/photoFrame';
import { protocolErrorCode } from '@velo/protocol';
import { AUTO_DOWNLOAD_BYTES, downloadAttachment, isImage } from '../shared/media/attachments';
import { cachedMediaDataUri, mediaDataUri } from '../shared/media/mediaStore';
import type { AttachmentMeta } from '../shared/storage/messageStore';
import { presentProtocolError } from '../shared/chat/protocolErrors';
import VoiceNoteView from './VoiceNoteView';
import { isAudio } from '../shared/media/attachments';

/**
 * T8.3: an attachment inside a bubble. On the device: shown. Not yet:
 * a placeholder with the dimensions, downloaded at once when small, on tap
 * otherwise; every integrity failure is shown in the security-warning tone.
 */
/**
 * A photo fills its bubble edge to edge (Telegram-style); the bubble clips the corners and
 * sizes itself with the same photoFrame, so the photo needs no margin or rounding of its own.
 */

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type ImageProps = {
  myUserId: string;
  meta: AttachmentMeta;
  mine: boolean;
  onOpen?: (uri: string) => void;
  /** the photo fills the whole bubble, so a long press is the way to the message's actions */
  onLongPress?: () => void;
  /** an album tile: this exact frame instead of the photo's own */
  frame?: { width: number; height: number };
};

export default function AttachmentView(props: ImageProps & { trailing?: React.ReactNode }) {
  if (isAudio(props.meta)) return <VoiceNoteView myUserId={props.myUserId} meta={props.meta} mine={props.mine} trailing={props.trailing} />; // T8.4
  return <ImageAttachment {...props} />;
}

function ImageAttachment({ myUserId, meta, mine, onOpen, onLongPress, frame: tileFrame }: ImageProps) {
  // An own photo (or one shown earlier in this process) renders at once from the cache; otherwise
  // the placeholder shows the dimensions and size, and offers a download only once the file
  // check has said the photo is not on the device (A2).
  const [uri, setUri] = useState<string | null>(() => cachedMediaDataUri(meta.blobId));
  const [checked, setChecked] = useState<boolean>(() => cachedMediaDataUri(meta.blobId) !== null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<{ text: string; warning: boolean } | null>(null);
  const startedRef = useRef(false);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const frame = tileFrame ?? photoFrame(meta, windowWidth, windowHeight);

  const download = async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setError(null);
    setProgress(0);
    try {
      await downloadAttachment({ myUserId, meta, onProgress: (loaded, total) => setProgress(total > 0 ? loaded / total : 0) });
      const u = await mediaDataUri(myUserId, meta.blobId, meta.contentType);
      setUri(u);
    } catch (e) {
      const code = protocolErrorCode(e);
      const p = code ? presentProtocolError(code) : null;
      setError({ text: p?.userMessage ?? 'Download failed. Tap to retry.', warning: Boolean(p?.securityWarning) });
      startedRef.current = false;
    } finally {
      setProgress(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = await mediaDataUri(myUserId, meta.blobId, meta.contentType);
      if (cancelled) return;
      setChecked(true);
      if (local) setUri(local);
      else if (meta.size <= AUTO_DOWNLOAD_BYTES) download();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.blobId, myUserId]);

  if (uri && isImage(meta)) {
    return (
      <Pressable onPress={() => onOpen?.(uri)} onLongPress={onLongPress} delayLongPress={350} accessibilityLabel="Open the photo" style={{ width: frame.width, height: frame.height }}>
        <Image source={{ uri }} style={{ width: frame.width, height: frame.height }} resizeMode="cover" accessibilityLabel="Photo" />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => {
        if (checked && progress === null && !uri) download();
      }}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityLabel="Download the attachment"
      className={`items-center justify-center ${mine ? 'bg-bubble-out' : 'bg-bubble-in'}`}
      style={{ width: frame.width, height: frame.height }}
    >
      {progress !== null ? (
        <>
          <Text className={`text-[13px] ${mine ? 'text-bubble-out-text' : 'text-text'}`}>{`Decrypting… ${Math.round(progress * 100)}%`}</Text>
          <View className="mt-2 h-1.5 w-2/3 overflow-hidden rounded-full bg-text/15">
            <View className="h-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
          </View>
        </>
      ) : error ? (
        <Text className={`px-3 text-center text-[12px] ${error.warning ? 'text-danger' : mine ? 'text-bubble-out-text' : 'text-muted'}`}>{error.text}</Text>
      ) : (
        <>
          <Text className={`text-[13px] font-semibold ${mine ? 'text-bubble-out-text' : 'text-text'}`}>{isImage(meta) ? 'Photo' : meta.name || 'File'}</Text>
          <Text className={`mt-1 text-[12px] ${mine ? 'text-bubble-out-muted' : 'text-muted'}`}>{checked ? `${formatBytes(meta.size)} · tap to download` : formatBytes(meta.size)}</Text>
        </>
      )}
    </Pressable>
  );
}
