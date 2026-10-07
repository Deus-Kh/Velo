import type { InterfaceDensity } from '../store/appearance.store';

export type DensityTokens = {
  rowVerticalPadding: number;
  bubbleHorizontalPadding: number;
  bubbleVerticalPadding: number;
  messageFontSize: number;
  messageLineHeight: number;
};

export const compactDensity: DensityTokens = {
  rowVerticalPadding: 8,
  bubbleHorizontalPadding: 12,
  bubbleVerticalPadding: 8,
  messageFontSize: 14,
  messageLineHeight: 20,
};

export const comfortableDensity: DensityTokens = {
  rowVerticalPadding: 12,
  bubbleHorizontalPadding: 16,
  bubbleVerticalPadding: 10,
  messageFontSize: 15,
  messageLineHeight: 21,
};

export function densityTokens(density: InterfaceDensity): DensityTokens {
  return density === 'compact' ? compactDensity : comfortableDensity;
}
