/**
 * The on-screen frame of a photo message, Telegram-style: the photo fills
 * its bubble edge to edge, so the frame is the bubble's width too (a caption
 * wraps at it). The frame keeps the photo's aspect ratio inside a box of at
 * most 72 % of the window width (320 dp cap) and half its height (400 dp
 * cap); very thin or very small photos stop at a minimum and are cropped
 * by the frame instead of becoming slivers.
 */
const MAX_WIDTH_FRACTION = 0.72;
const MAX_WIDTH_CAP = 320;
const MAX_HEIGHT_FRACTION = 0.5;
const MAX_HEIGHT_CAP = 400;
export const PHOTO_MIN_WIDTH = 150;
const MIN_HEIGHT = 100;

export function photoFrame(
  size: { width?: number; height?: number },
  windowWidth: number,
  windowHeight: number,
): { width: number; height: number } {
  const w = size.width && size.width > 0 ? size.width : 4;
  const h = size.height && size.height > 0 ? size.height : 3;
  const maxWidth = Math.max(PHOTO_MIN_WIDTH, Math.min(MAX_WIDTH_CAP, Math.floor(windowWidth * MAX_WIDTH_FRACTION)));
  const maxHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT_CAP, Math.floor(windowHeight * MAX_HEIGHT_FRACTION)));
  const scale = Math.min(maxWidth / w, maxHeight / h);
  return {
    width: Math.min(maxWidth, Math.max(PHOTO_MIN_WIDTH, Math.round(w * scale))),
    height: Math.min(maxHeight, Math.max(MIN_HEIGHT, Math.round(h * scale))),
  };
}
