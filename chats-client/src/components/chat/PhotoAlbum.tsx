import { View } from 'react-native';
import AttachmentView from '../AttachmentView';
import { albumLayout } from '../../shared/media/albumLayout';
import type { AttachmentMeta } from '../../shared/storage/messageStore';

type AlbumPhoto = { id: string; attachment?: AttachmentMeta | null };

/** The size an album is drawn at; the bubble uses the same numbers. */
export function albumFrame(photos: AlbumPhoto[], width: number): { width: number; height: number } {
  return { width, height: albumLayout(photos.map((p) => p.attachment ?? {}), width).height };
}

/**
 * Photos sent together, in one bubble (Telegram-style): a justified grid
 * (albumLayout) of tiles. Each tile is its own message: a tap opens it in
 * the viewer, a long press opens that photo's actions.
 */
export default function PhotoAlbum<T extends AlbumPhoto>({
  myUserId,
  photos,
  mine,
  width,
  onOpen,
  onLongPressPhoto,
}: {
  myUserId: string;
  photos: T[];
  mine: boolean;
  width: number;
  onOpen: (uri: string) => void;
  onLongPressPhoto: (photo: T) => void;
}) {
  const { tiles, height } = albumLayout(photos.map((p) => p.attachment ?? {}), width);
  return (
    <View style={{ width, height }}>
      {photos.map((photo, i) => {
        const tile = tiles[i]!;
        if (!photo.attachment) return null;
        return (
          <View key={photo.id} className="absolute" style={{ left: tile.x, top: tile.y }}>
            <AttachmentView
              myUserId={myUserId}
              meta={photo.attachment}
              mine={mine}
              frame={{ width: tile.width, height: tile.height }}
              onOpen={onOpen}
              onLongPress={() => onLongPressPhoto(photo)}
            />
          </View>
        );
      })}
    </View>
  );
}
