import { resolveBackPress } from '../../ui/layeredBack';
import { settingsBackLayers } from '../settingsBack';

const closed = { onSubpage: false, blocked: false, trusted: false, verificationHelp: false, profileSheet: false, profileBusy: false, deleteAccount: false, deleteBusy: false };

function press(state: Partial<typeof closed>) {
  const calls: string[] = [];
  const close = {
    subpage: () => calls.push('subpage'),
    blocked: () => calls.push('blocked'),
    trusted: () => calls.push('trusted'),
    verificationHelp: () => calls.push('verificationHelp'),
    profileSheet: () => calls.push('profileSheet'),
    deleteAccount: () => calls.push('deleteAccount'),
  };
  const layers = settingsBackLayers({ ...closed, ...state }, close);
  const anyOpen = layers.some((l) => l.open);
  if (anyOpen) resolveBackPress(layers, () => calls.push('screen'));
  return { calls, handled: anyOpen };
}

describe('Settings hardware Back (C4)', () => {
  it('on the Settings list nothing is open, so Back is left to Android', () => {
    expect(press({})).toEqual({ calls: [], handled: false });
  });

  it('on a subpage Back returns to the Settings list', () => {
    expect(press({ onSubpage: true })).toEqual({ calls: ['subpage'], handled: true });
  });

  it('an open sheet closes first, the subpage stays', () => {
    expect(press({ onSubpage: true, trusted: true }).calls).toEqual(['trusted']);
    expect(press({ onSubpage: true, verificationHelp: true }).calls).toEqual(['verificationHelp']);
  });

  it('a sheet that is saving does not close, and Back does not fall through to the subpage', () => {
    expect(press({ onSubpage: true, deleteAccount: true, deleteBusy: true })).toEqual({ calls: [], handled: true });
    expect(press({ onSubpage: true, profileSheet: true, profileBusy: true })).toEqual({ calls: [], handled: true });
    expect(press({ onSubpage: true, profileSheet: true }).calls).toEqual(['profileSheet']);
  });
});
