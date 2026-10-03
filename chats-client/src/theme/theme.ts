export type ThemeColors = {
  "--color-background": string;
  "--color-background-alt": string;
  "--color-surface": string;
  "--color-surface-elevated": string;
  "--color-border": string;
  "--color-text-primary": string;
  "--color-text-secondary": string;
  "--color-primary": string;
  "--color-primary-soft": string;
  "--color-success": string;
  "--color-warning": string;
  "--color-danger": string;
  /** B3: message bubbles. Outgoing is the accent at reduced saturation with its own text pair; incoming is the elevated surface. */
  "--color-bubble-out": string;
  "--color-bubble-out-text": string;
  "--color-bubble-out-muted": string;
  "--color-bubble-in": string;
  /** A hairline around incoming bubbles; equal to the bubble colour where no line is wanted. */
  "--color-bubble-in-border": string;
};

export const lightTheme: ThemeColors = {
  "--color-background": "248 250 252",
  "--color-background-alt": "241 245 249",
  "--color-surface": "255 255 255",
  "--color-surface-elevated": "255 255 255",
  "--color-border": "226 232 240",
  "--color-text-primary": "15 23 42",
  "--color-text-secondary": "100 116 139",
  "--color-primary": "14 116 144",
  "--color-primary-soft": "207 250 254",
  "--color-success": "5 150 105",
  "--color-warning": "217 119 6",
  "--color-danger": "220 38 38",
  // a pale teal tint with dark text (B10: the inverse of the old dark-teal-on-white)
  "--color-bubble-out": "204 240 233",
  "--color-bubble-out-text": "15 23 42",
  "--color-bubble-out-muted": "62 98 94",
  // a white card with a hairline
  "--color-bubble-in": "255 255 255",
  "--color-bubble-in-border": "226 232 240",
};

export const darkTheme: ThemeColors = {
  "--color-background": "4 11 20",
  "--color-background-alt": "9 18 31",
  "--color-surface": "12 24 40",
  "--color-surface-elevated": "18 34 54",
  "--color-border": "42 63 87",
  "--color-text-primary": "241 245 249",
  "--color-text-secondary": "148 163 184",
  "--color-primary": "45 212 191",
  "--color-primary-soft": "17 94 89",
  "--color-success": "52 211 153",
  "--color-warning": "251 191 36",
  "--color-danger": "248 113 113",
  // a dark teal with light text instead of the saturated accent surface
  "--color-bubble-out": "26 86 83",
  "--color-bubble-out-text": "241 245 249",
  "--color-bubble-out-muted": "190 214 212",
  "--color-bubble-in": "18 34 54",
  "--color-bubble-in-border": "18 34 54",
};
