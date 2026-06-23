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
};
