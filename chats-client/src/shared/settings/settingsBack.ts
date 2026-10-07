import type { BackLayer } from '../ui/layeredBack';

/**
 * C4: what hardware Back closes on the Settings tab, bottom to top for
 * resolveBackPress: the open subpage (back to the Settings list), then any
 * open sheet. A sheet that is saving (profile, account deletion) does not
 * close under the user; Back is still consumed so the subpage stays.
 */
export function settingsBackLayers(
  s: {
    onSubpage: boolean;
    blocked: boolean;
    trusted: boolean;
    verificationHelp: boolean;
    profileSheet: boolean;
    profileBusy: boolean;
    deleteAccount: boolean;
    deleteBusy: boolean;
  },
  close: {
    subpage: () => void;
    blocked: () => void;
    trusted: () => void;
    verificationHelp: () => void;
    profileSheet: () => void;
    deleteAccount: () => void;
  },
): BackLayer[] {
  return [
    { open: s.onSubpage, close: close.subpage },
    { open: s.blocked, close: close.blocked },
    { open: s.trusted, close: close.trusted },
    { open: s.verificationHelp, close: close.verificationHelp },
    { open: s.profileSheet, close: () => (s.profileBusy ? undefined : close.profileSheet()) },
    { open: s.deleteAccount, close: () => (s.deleteBusy ? undefined : close.deleteAccount()) },
  ];
}
