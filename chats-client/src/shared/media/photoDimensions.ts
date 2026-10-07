/**
 * The size a picked photo is shown at (C3b).
 *
 * react-native-image-picker already reports upright dimensions for the two
 * plain rotations: its Android `getImageDimensions` swaps width and height
 * when the EXIF orientation is 6 (rotate 90) or 8 (rotate 270). It does not
 * swap for the mirrored rotations 5 and 7, which also turn the image on its
 * side. So the only correction left for us is those two. Swapping again for
 * 6 and 8 (as A18 did) turns a portrait photo's frame back into landscape.
 */
export function displayDimensions(
  pickerWidth: number | undefined,
  pickerHeight: number | undefined,
  orientation: number,
): { width?: number; height?: number } {
  const pickerMissedRotation = orientation === 5 || orientation === 7;
  return pickerMissedRotation ? { width: pickerHeight, height: pickerWidth } : { width: pickerWidth, height: pickerHeight };
}
